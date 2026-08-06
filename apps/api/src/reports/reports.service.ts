import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import ExcelJS from 'exceljs';
import { AuditAction, ReportFormat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AssessmentService } from '../assessment/assessment.service';
import { FONT_TH, FONT_TH_BOLD, LOGO_FACULTY, LOGO_UNIVERSITY } from './report-assets';
import { AuthenticatedUser } from '../common/authenticated-user';

const WEB_BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

function tierOf(rate: number): 'OK' | 'WARNING' | 'RISK' | 'CRITICAL' {
  if (rate < 60) return 'CRITICAL';
  if (rate < 70) return 'RISK';
  if (rate < 80) return 'WARNING';
  return 'OK';
}
const TIER_TH: Record<string, string> = { OK: 'ปกติ', WARNING: 'เฝ้าระวัง', RISK: 'เสี่ยง', CRITICAL: 'วิกฤต' };
const STATUS_TH: Record<string, string> = { PRESENT: 'มาเรียน', LATE: 'สาย', ABSENT: 'ขาด', EXCUSED: 'ลาป่วย/ลากิจ', LEAVE: 'ลา' };

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly assessment: AssessmentService,
  ) {}

  private thaiDateTime(d: Date): string {
    return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
      dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok',
    }).format(d);
  }

  /**
   * Display name for a person on an official document. International
   * students commonly have no Thai name at all, and some nationalities have
   * no surname — nameEn is the only guaranteed field. Show whichever
   * language exists; when both do, show both rather than silently dropping
   * one (a plain `nameTh ?? nameEn` loses the English name for every
   * student who has both, which matters for cross-referencing against a
   * passport or student ID card).
   */
  private personName(nameEn: string, nameTh?: string | null): string {
    return nameTh ? `${nameTh} (${nameEn})` : nameEn;
  }

  private newReportNumber(): string {
    const d = new Date();
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return `RPT-${ymd}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  /** Attendance overview for the report — scoped per-lecturer via AnalyticsService.overview(). */
  private async gather(user: AuthenticatedUser) {
    const universityId = user.universityId;
    const [university, faculty, overview] = await Promise.all([
      this.prisma.university.findUnique({ where: { id: universityId }, select: { nameEn: true, nameTh: true, code: true } }),
      this.prisma.faculty.findFirst({ where: { universityId, code: 'NURSING' }, select: { nameEn: true, nameTh: true } }),
      this.analytics.overview(user),
    ]);
    return { university, faculty, overview };
  }

  private async register(
    universityId: string, format: ReportFormat, checksum: string,
    byId?: string, byName?: string,
    type = 'ATTENDANCE_SUMMARY', title = 'Attendance Summary Report',
  ) {
    const reportNumber = this.newReportNumber();
    await this.prisma.report.create({
      data: {
        universityId, reportNumber, format, checksum, type, title,
        generatedById: byId ?? null, generatedByName: byName ?? null,
      },
    });
    await this.prisma.auditLog.create({
      data: { universityId, userId: byId ?? null, action: AuditAction.EXPORT, entityType: 'Report', metadata: { reportNumber, format } },
    });
    return reportNumber;
  }

  /**
   * Persists the exact generated file so the QR/verify link can hand back
   * the real document later, not just a "yes, this number is genuine" page.
   * Only called for PDFs — CSV/XLSX exports have no QR code pointing at them.
   */
  private async storeContent(reportNumber: string, content: Buffer, contentType: string) {
    await this.prisma.report.update({ where: { reportNumber }, data: { content: new Uint8Array(content), contentType } });
  }

  /**
   * Tiles a low-opacity, rotated watermark across the current page. Applied
   * as a background layer before the report content is drawn, so it reads
   * clearly without interfering with the table/text on top. Every PDF this
   * service issues carries it — a scanned or printed copy has to visibly
   * come from ClassWeb and be flagged as faculty-internal-only, not just a
   * document that happens to validate against the verify page.
   */
  private watermark(doc: PDFKit.PDFDocument, font: string) {
    const text = 'สำหรับตรวจสอบและใช้ภายในคณะฯ เท่านั้น · FOR VERIFICATION / FACULTY-INTERNAL USE ONLY';
    const { width, height } = doc.page;
    doc.save();
    doc.rotate(-30, { origin: [width / 2, height / 2] });
    doc.font(font).fontSize(11).fillColor('#0e2a4a', 0.06);
    const stepX = 260;
    const stepY = 70;
    for (let y = -height; y < height * 2; y += stepY) {
      for (let x = -width; x < width * 2; x += stepX) {
        doc.text(text, x, y, { lineBreak: false });
      }
    }
    doc.restore();
    doc.fillColor('#000000', 1); // reset opacity for whatever draws next
  }

  async verify(reportNumber: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportNumber },
      select: { reportNumber: true, type: true, title: true, format: true, generatedByName: true, createdAt: true, checksum: true, content: true, university: { select: { nameEn: true, nameTh: true } } },
    });
    if (!report) throw new NotFoundException('Report not found — this document could not be verified');
    const { content, ...rest } = report;
    return { valid: true, hasFile: content != null, ...rest };
  }

  /** The actual file behind a report's QR code / verify link. */
  async file(reportNumber: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportNumber },
      select: { content: true, contentType: true },
    });
    if (!report?.content) throw new NotFoundException('No file is stored for this report');
    return { content: Buffer.from(report.content), contentType: report.contentType ?? 'application/pdf' };
  }

  // ---- PDF --------------------------------------------------------------

  async attendancePdf(user: AuthenticatedUser, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const universityId = user.universityId;
    const { university, faculty, overview } = await this.gather(user);
    const checksum = createHash('sha256').update(JSON.stringify(overview)).digest('hex');
    const reportNumber = await this.register(universityId, 'PDF', checksum, byId, byName);
    const verifyUrl = `${WEB_BASE}/verify/${reportNumber}`;
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 });
    const qrPng = Buffer.from(qrDataUrl.split(',')[1], 'base64');

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const th = FONT_TH(); const thBold = FONT_TH_BOLD();
    if (th) doc.registerFont('TH', th);
    if (thBold) doc.registerFont('THB', thBold);
    const F = th ? 'TH' : 'Helvetica';
    const FB = thBold ? 'THB' : 'Helvetica-Bold';
    this.watermark(doc, F);
    const pageW = doc.page.width;
    const left = 40; const right = pageW - 40;

    // Header: logos + titles
    const uniLogo = LOGO_UNIVERSITY(); const facLogo = LOGO_FACULTY();
    if (uniLogo) doc.image(uniLogo, left, 38, { width: 54 });
    if (facLogo) doc.image(facLogo, right - 54, 36, { width: 54 });
    doc.font(FB).fontSize(20).fillColor('#26303f')
      .text(university?.nameTh ?? university?.nameEn ?? 'University', 100, 42, { width: pageW - 200, align: 'center' });
    doc.font(FB).fontSize(17).fillColor('#0e2a4a')
      .text(faculty?.nameTh ?? faculty?.nameEn ?? 'Faculty of Nursing', 100, 68, { width: pageW - 200, align: 'center' });
    doc.font(F).fontSize(15).fillColor('#4a5666')
      .text('รายงานสรุปการเข้าเรียน (Attendance Summary Report)', 100, 92, { width: pageW - 200, align: 'center' });

    doc.moveTo(left, 122).lineTo(right, 122).strokeColor('#ff8a4c').lineWidth(2).stroke();

    // Report number + generated time
    doc.font(F).fontSize(13).fillColor('#4a5666');
    doc.text(`เลขที่รายงาน (Report No.): ${reportNumber}`, left, 130);
    doc.text(`ออกรายงานเมื่อ (Generated): ${this.thaiDateTime(new Date())}`, left, 148);

    // Summary box
    let y = 178;
    doc.roundedRect(left, y, right - left, 66, 10).fillAndStroke('#fff6ee', '#ffd9bf');
    doc.fillColor('#26303f').font(FB).fontSize(15).text('สรุปภาพรวม (Summary)', left + 14, y + 8);
    doc.font(F).fontSize(14).fillColor('#4a5666');
    const rate = overview.overallRate ?? 0;
    doc.text(`เข้าเรียนโดยรวม: ${rate}%`, left + 14, y + 30);
    doc.text(`มาเรียน ${overview.totals.present} · สาย ${overview.totals.late} · ขาด ${overview.totals.absent}  (รวม ${overview.totals.records} รายการ)`, left + 180, y + 30);
    doc.text(`นักศึกษากลุ่มเสี่ยง: ต่ำกว่า 80% = ${overview.risk.below80} · ต่ำกว่า 70% = ${overview.risk.below70} · ต่ำกว่า 60% = ${overview.risk.below60}`, left + 14, y + 46);

    // At-risk table
    y += 86;
    doc.font(FB).fontSize(15).fillColor('#26303f').text('รายชื่อนักศึกษากลุ่มเสี่ยง (Students at Risk)', left, y);
    y += 24;
    const cols = [left, left + 30, left + 130, left + 330, left + 420];
    const headers = ['ลำดับ', 'รหัส', 'ชื่อ-สกุล', 'เข้าเรียน %', 'สถานะ'];
    doc.roundedRect(left, y - 4, right - left, 22, 4).fill('#0e7c7b');
    doc.font(FB).fontSize(13).fillColor('#ffffff');
    headers.forEach((h, i) => doc.text(h, cols[i] + 4, y, { width: (cols[i + 1] ?? right) - cols[i] - 6 }));
    y += 22;
    doc.font(F).fontSize(13).fillColor('#26303f');
    const tierTh: Record<string, string> = { WARNING: 'เฝ้าระวัง', RISK: 'เสี่ยง', CRITICAL: 'วิกฤต', OK: 'ปกติ' };
    if (overview.atRisk.length === 0) {
      doc.text('— ไม่มีนักศึกษากลุ่มเสี่ยง —', left + 4, y + 2); y += 22;
    } else {
      overview.atRisk.forEach((s, i) => {
        if (i % 2 === 1) doc.rect(left, y - 3, right - left, 20).fill('#f6f8fb').fillColor('#26303f');
        doc.fillColor('#26303f');
        doc.text(String(i + 1), cols[0] + 4, y, { width: cols[1] - cols[0] - 6 });
        doc.text(s.studentCode, cols[1] + 4, y, { width: cols[2] - cols[1] - 6 });
        doc.text(this.personName(s.nameEn, s.nameTh), cols[2] + 4, y, { width: cols[3] - cols[2] - 6, lineBreak: false, ellipsis: true });
        doc.text(`${s.rate}%`, cols[3] + 4, y, { width: cols[4] - cols[3] - 6 });
        doc.text(tierTh[s.tier] ?? s.tier, cols[4] + 4, y, { width: right - cols[4] - 6 });
        y += 20;
      });
    }

    // Signature + QR at the bottom (fixed positions; lineBreak:false avoids
    // accidental pagination when text sits near the bottom margin).
    const footY = doc.page.height - 168;
    doc.image(qrPng, left, footY, { width: 80 });
    doc.font(F).fontSize(10).fillColor('#7c8798')
      .text('สแกนเพื่อตรวจสอบ', left - 15, footY + 82, { width: 110, align: 'center', lineBreak: false });
    doc.font(F).fontSize(14).fillColor('#26303f');
    doc.text('.................................................', right - 220, footY + 30, { width: 220, align: 'center', lineBreak: false });
    doc.text('ผู้รับรอง / Authorised signature', right - 220, footY + 50, { width: 220, align: 'center', lineBreak: false });
    if (byName) doc.text(`(${byName})`, right - 220, footY + 68, { width: 220, align: 'center', lineBreak: false });

    // Footer line (kept above the bottom margin to avoid an extra page)
    doc.font(F).fontSize(9).fillColor('#a0aab8')
      .text(`Generated by ClassWeb · ${reportNumber} · verify at ${verifyUrl}`, left, doc.page.height - 58, { width: right - left, align: 'center', lineBreak: false });

    doc.end();
    const buffer = await done;
    await this.storeContent(reportNumber, buffer, 'application/pdf');
    return { buffer, reportNumber };
  }

  // ---- CSV --------------------------------------------------------------

  async attendanceCsv(user: AuthenticatedUser, byId?: string, byName?: string): Promise<{ content: string; reportNumber: string }> {
    const universityId = user.universityId;
    const { overview } = await this.gather(user);
    const checksum = createHash('sha256').update(JSON.stringify(overview)).digest('hex');
    const reportNumber = await this.register(universityId, 'CSV', checksum, byId, byName);
    const rows = [
      ['Report No.', reportNumber],
      ['Generated', new Date().toISOString()],
      ['Overall rate (%)', String(overview.overallRate ?? '')],
      [],
      ['#', 'Student code', 'Name (EN)', 'Name (TH)', 'Program', 'Present', 'Late', 'Absent', 'Rate %', 'Tier', 'Badges'],
      ...overview.atRisk.concat(overview.top.filter((t) => !overview.atRisk.some((r) => r.studentId === t.studentId)))
        .map((s, i) => [String(i + 1), s.studentCode, s.nameEn, s.nameTh ?? '', s.program, String(s.present), String(s.late), String(s.absent), String(s.rate), s.tier, s.badges.join('|')]),
    ];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const content = '﻿' + rows.map((r) => r.map((c) => esc(String(c))).join(',')).join('\n');
    return { content, reportNumber };
  }

  // ---- Excel ------------------------------------------------------------

  async attendanceXlsx(user: AuthenticatedUser, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const universityId = user.universityId;
    const { university, faculty, overview } = await this.gather(user);
    const checksum = createHash('sha256').update(JSON.stringify(overview)).digest('hex');
    const reportNumber = await this.register(universityId, 'XLSX', checksum, byId, byName);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'ClassWeb';
    const ws = wb.addWorksheet('Attendance');
    ws.addRow([university?.nameTh ?? 'University']);
    ws.addRow([faculty?.nameTh ?? 'Faculty of Nursing']);
    ws.addRow(['รายงานสรุปการเข้าเรียน (Attendance Summary Report)']);
    ws.addRow([`Report No.: ${reportNumber}`]);
    ws.addRow([`Generated: ${this.thaiDateTime(new Date())}`]);
    ws.addRow([`Overall rate: ${overview.overallRate ?? '-'}%  ·  Present ${overview.totals.present} / Late ${overview.totals.late} / Absent ${overview.totals.absent}`]);
    ws.addRow([]);
    const header = ws.addRow(['#', 'Student code', 'Name (EN)', 'Name (TH)', 'Program', 'Present', 'Late', 'Absent', 'Rate %', 'Tier', 'Badges']);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7C7B' } }; });
    const all = overview.atRisk.concat(overview.top.filter((t) => !overview.atRisk.some((r) => r.studentId === t.studentId)));
    all.forEach((s, i) => ws.addRow([i + 1, s.studentCode, s.nameEn, s.nameTh ?? '', s.program, s.present, s.late, s.absent, s.rate, s.tier, s.badges.join(', ')]));
    ws.columns.forEach((c) => { c.width = 16; });
    ws.getColumn(3).width = 22; ws.getColumn(4).width = 22;

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return { buffer, reportNumber };
  }

  // ---- Per-student report ----------------------------------------------

  private async gatherStudent(universityId: string, studentId: string) {
    const [university, faculty, student] = await Promise.all([
      this.prisma.university.findUnique({ where: { id: universityId }, select: { nameEn: true, nameTh: true } }),
      this.prisma.faculty.findFirst({ where: { universityId, code: 'NURSING' }, select: { nameEn: true, nameTh: true } }),
      this.prisma.student.findFirst({
        where: { id: studentId, universityId, deletedAt: null },
        select: { studentCode: true, nameEn: true, nameTh: true, status: true, admissionYear: true, program: { select: { code: true, nameEn: true } } },
      }),
    ]);
    if (!student) throw new NotFoundException('Student not found in this tenant');

    const records = await this.prisma.attendanceRecord.findMany({
      where: { studentId, enrollment: { section: { universityId } } },
      select: {
        status: true,
        classSession: { select: { sessionDate: true, section: { select: { subject: { select: { code: true, nameEn: true } } } } } },
      },
      orderBy: { classSession: { sessionDate: 'desc' } },
    });

    const total = records.length;
    const present = records.filter((r) => r.status === 'PRESENT').length;
    const late = records.filter((r) => r.status === 'LATE').length;
    const absent = records.filter((r) => r.status === 'ABSENT').length;
    const rate = total > 0 ? Math.round(((present + late) / total) * 1000) / 10 : 0;

    const bySubjectMap = new Map<string, { code: string; name: string; present: number; late: number; absent: number; total: number }>();
    for (const r of records) {
      const code = r.classSession.section.subject.code;
      const e = bySubjectMap.get(code) ?? { code, name: r.classSession.section.subject.nameEn, present: 0, late: 0, absent: 0, total: 0 };
      e.total++;
      if (r.status === 'PRESENT') e.present++; else if (r.status === 'LATE') e.late++; else if (r.status === 'ABSENT') e.absent++;
      bySubjectMap.set(code, e);
    }
    const bySubject = [...bySubjectMap.values()].map((e) => ({ ...e, rate: e.total > 0 ? Math.round(((e.present + e.late) / e.total) * 1000) / 10 : 0 }));
    const log = records.map((r) => ({ date: r.classSession.sessionDate, subject: r.classSession.section.subject.code, status: r.status }));

    return { university, faculty, student, total, present, late, absent, rate, tier: tierOf(rate), bySubject, log };
  }

  async studentPdf(universityId: string, studentId: string, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const d = await this.gatherStudent(universityId, studentId);
    const checksum = createHash('sha256').update(JSON.stringify({ code: d.student.studentCode, rate: d.rate, total: d.total })).digest('hex');
    const reportNumber = await this.register(universityId, 'PDF', checksum, byId, byName, 'STUDENT_ATTENDANCE', `Student report ${d.student.studentCode}`);
    const verifyUrl = `${WEB_BASE}/verify/${reportNumber}`;
    const qrPng = Buffer.from((await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 })).split(',')[1], 'base64');

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const th = FONT_TH(); const thBold = FONT_TH_BOLD();
    if (th) doc.registerFont('TH', th);
    if (thBold) doc.registerFont('THB', thBold);
    const F = th ? 'TH' : 'Helvetica'; const FB = thBold ? 'THB' : 'Helvetica-Bold';
    const pageW = doc.page.width; const left = 40; const right = pageW - 40;

    // Header
    const uniLogo = LOGO_UNIVERSITY(); const facLogo = LOGO_FACULTY();
    if (uniLogo) doc.image(uniLogo, left, 38, { width: 50 });
    if (facLogo) doc.image(facLogo, right - 50, 36, { width: 50 });
    doc.font(FB).fontSize(18).fillColor('#26303f').text(d.university?.nameTh ?? 'University', 100, 44, { width: pageW - 200, align: 'center' });
    doc.font(FB).fontSize(15).fillColor('#0e2a4a').text(d.faculty?.nameTh ?? 'Faculty of Nursing', 100, 66, { width: pageW - 200, align: 'center' });
    doc.font(F).fontSize(14).fillColor('#4a5666').text('รายงานการเข้าเรียนรายบุคคล (Individual Attendance Report)', 100, 86, { width: pageW - 200, align: 'center' });
    doc.moveTo(left, 112).lineTo(right, 112).strokeColor('#ff8a4c').lineWidth(2).stroke();

    // Student info + summary box
    let y = 122;
    doc.font(F).fontSize(12).fillColor('#4a5666').text(`เลขที่รายงาน: ${reportNumber}    ออกเมื่อ: ${this.thaiDateTime(new Date())}`, left, y);
    y += 22;
    doc.roundedRect(left, y, right - left, 78, 10).fillAndStroke('#fff6ee', '#ffd9bf');
    doc.fillColor('#26303f').font(FB).fontSize(14).text(`${this.personName(d.student.nameEn, d.student.nameTh)}  (${d.student.studentCode})`, left + 14, y + 10);
    doc.font(F).fontSize(12).fillColor('#4a5666');
    doc.text(`หลักสูตร: ${d.student.program.code} · สถานะ: ${d.student.status}${d.student.admissionYear ? ` · ปีที่เข้า: ${d.student.admissionYear}` : ''}`, left + 14, y + 32);
    doc.font(FB).fontSize(13).fillColor('#26303f')
      .text(`เข้าเรียนโดยรวม: ${d.rate}%  (${TIER_TH[d.tier]})    มาเรียน ${d.present} · สาย ${d.late} · ขาด ${d.absent}  รวม ${d.total} คาบ`, left + 14, y + 52);
    y += 96;

    // Per-subject breakdown
    doc.font(FB).fontSize(14).fillColor('#26303f').text('สรุปแยกรายวิชา (By subject)', left, y); y += 22;
    const sc = [left, left + 90, left + 300, left + 360, left + 420, left + 480];
    doc.roundedRect(left, y - 4, right - left, 20, 4).fill('#0e7c7b');
    doc.font(FB).fontSize(11).fillColor('#fff');
    ['รหัสวิชา', 'ชื่อวิชา', 'มา', 'สาย', 'ขาด', 'เข้าเรียน%'].forEach((h, i) => doc.text(h, sc[i] + 3, y, { width: (sc[i + 1] ?? right) - sc[i] - 5 }));
    y += 20;
    doc.font(F).fontSize(11).fillColor('#26303f');
    for (const s of d.bySubject) {
      doc.text(s.code, sc[0] + 3, y, { width: sc[1] - sc[0] - 5 });
      doc.text(s.name, sc[1] + 3, y, { width: sc[2] - sc[1] - 5, lineBreak: false, ellipsis: true });
      doc.text(String(s.present), sc[2] + 3, y); doc.text(String(s.late), sc[3] + 3, y); doc.text(String(s.absent), sc[4] + 3, y);
      doc.text(`${s.rate}%`, sc[5] + 3, y);
      y += 18;
    }
    y += 12;

    // Detailed session log (paginated)
    doc.font(FB).fontSize(14).fillColor('#26303f').text('บันทึกการเข้าเรียนรายคาบ (Session log)', left, y); y += 22;
    const lc = [left, left + 150, left + 320];
    const drawLogHeader = (yy: number) => {
      doc.roundedRect(left, yy - 4, right - left, 20, 4).fill('#0e7c7b');
      doc.font(FB).fontSize(11).fillColor('#fff');
      ['วันที่', 'รายวิชา', 'สถานะ'].forEach((h, i) => doc.text(h, lc[i] + 3, yy, { width: (lc[i + 1] ?? right) - lc[i] - 5 }));
      return yy + 20;
    };
    y = drawLogHeader(y);
    doc.font(F).fontSize(11).fillColor('#26303f');
    const fmtDate = (dt: Date) => new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(dt));
    d.log.forEach((row, i) => {
      if (y > doc.page.height - 80) { doc.addPage(); y = 50; y = drawLogHeader(y); doc.font(F).fontSize(11).fillColor('#26303f'); }
      if (i % 2 === 1) { doc.rect(left, y - 3, right - left, 18).fill('#f6f8fb'); doc.fillColor('#26303f'); }
      doc.text(fmtDate(row.date), lc[0] + 3, y, { width: lc[1] - lc[0] - 5 });
      doc.text(row.subject, lc[1] + 3, y, { width: lc[2] - lc[1] - 5 });
      doc.text(STATUS_TH[row.status] ?? row.status, lc[2] + 3, y);
      y += 18;
    });

    // Signature + QR (flow after content)
    if (y > doc.page.height - 170) { doc.addPage(); y = 60; }
    const sy = y + 20;
    doc.image(qrPng, left, sy, { width: 78 });
    doc.font(F).fontSize(10).fillColor('#7c8798').text('สแกนเพื่อตรวจสอบ', left - 15, sy + 80, { width: 108, align: 'center', lineBreak: false });
    doc.font(F).fontSize(13).fillColor('#26303f');
    doc.text('.................................................', right - 220, sy + 28, { width: 220, align: 'center', lineBreak: false });
    doc.text('ผู้รับรอง / Authorised signature', right - 220, sy + 46, { width: 220, align: 'center', lineBreak: false });

    // Footer on every page. Zero the bottom margin while stamping so writing
    // near the page edge never auto-appends a blank page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      this.watermark(doc, F);
      doc.page.margins.bottom = 0;
      doc.font(F).fontSize(9).fillColor('#a0aab8')
        .text(`Generated by ClassWeb · ${reportNumber} · verify at ${verifyUrl} · หน้า ${i + 1}/${range.count}`, left, doc.page.height - 40, { width: right - left, align: 'center', lineBreak: false });
    }
    doc.flushPages();

    doc.end();
    const buffer = await done;
    await this.storeContent(reportNumber, buffer, 'application/pdf');
    return { buffer, reportNumber };
  }

  async studentCsv(universityId: string, studentId: string, byId?: string, byName?: string): Promise<{ content: string; reportNumber: string }> {
    const d = await this.gatherStudent(universityId, studentId);
    const checksum = createHash('sha256').update(JSON.stringify({ code: d.student.studentCode, rate: d.rate })).digest('hex');
    const reportNumber = await this.register(universityId, 'CSV', checksum, byId, byName, 'STUDENT_ATTENDANCE', `Student report ${d.student.studentCode}`);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows: string[][] = [
      ['Report No.', reportNumber],
      ['Student', `${d.student.studentCode} ${d.student.nameEn}`],
      ['Program', d.student.program.code],
      ['Overall rate (%)', String(d.rate)],
      ['Present/Late/Absent', `${d.present}/${d.late}/${d.absent}`],
      [],
      ['Date', 'Subject', 'Status'],
      ...d.log.map((r) => [new Date(r.date).toISOString().slice(0, 10), r.subject, r.status]),
    ];
    return { content: '﻿' + rows.map((r) => r.map((c) => esc(String(c))).join(',')).join('\n'), reportNumber };
  }

  async studentXlsx(universityId: string, studentId: string, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const d = await this.gatherStudent(universityId, studentId);
    const checksum = createHash('sha256').update(JSON.stringify({ code: d.student.studentCode, rate: d.rate })).digest('hex');
    const reportNumber = await this.register(universityId, 'XLSX', checksum, byId, byName, 'STUDENT_ATTENDANCE', `Student report ${d.student.studentCode}`);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Student');
    ws.addRow([`${this.personName(d.student.nameEn, d.student.nameTh)} (${d.student.studentCode})`]);
    ws.addRow([`Report No.: ${reportNumber}`]);
    ws.addRow([`Overall: ${d.rate}%  ·  Present ${d.present} / Late ${d.late} / Absent ${d.absent}`]);
    ws.addRow([]);
    const header = ws.addRow(['Date', 'Subject', 'Status']);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7C7B' } }; });
    d.log.forEach((r) => ws.addRow([new Date(r.date).toISOString().slice(0, 10), r.subject, r.status]));
    ws.columns.forEach((c) => { c.width = 18; });
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), reportNumber };
  }

  // ---- Grade reports: per-section grade sheet ----------------------------

  private async gatherSectionGrades(user: AuthenticatedUser, sectionId: string) {
    const universityId = user.universityId;
    const [university, faculty, section] = await Promise.all([
      this.prisma.university.findUnique({ where: { id: universityId }, select: { nameEn: true, nameTh: true } }),
      this.prisma.faculty.findFirst({ where: { universityId, code: 'NURSING' }, select: { nameEn: true, nameTh: true } }),
      this.prisma.section.findFirst({
        where: { id: sectionId, universityId, deletedAt: null },
        select: { subjectId: true, sectionNo: true, subject: { select: { code: true, nameEn: true, nameTh: true } } },
      }),
    ]);
    if (!section) throw new NotFoundException('Section not found in this tenant');

    const [rubrics, summary, evaluations] = await Promise.all([
      this.assessment.activeRubricsForSubject(universityId, section.subjectId),
      this.assessment.sectionSummary(user, sectionId),
      this.prisma.evaluation.findMany({ where: { universityId, sectionId }, select: { studentId: true, rubricId: true, scorePercent: true } }),
    ]);
    const scoreMap = new Map(evaluations.map((e) => [`${e.studentId}:${e.rubricId}`, e.scorePercent]));
    const students = summary.students.map((s) => ({ ...s, scores: rubrics.map((r) => scoreMap.get(`${s.studentId}:${r.id}`) ?? null) }));

    return { university, faculty, section, rubrics, students };
  }

  async sectionGradesPdf(user: AuthenticatedUser, sectionId: string, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const universityId = user.universityId;
    const d = await this.gatherSectionGrades(user, sectionId);
    const checksum = createHash('sha256').update(JSON.stringify({ sectionId, students: d.students.map((s) => [s.studentId, s.total]) })).digest('hex');
    const reportNumber = await this.register(universityId, 'PDF', checksum, byId, byName, 'SECTION_GRADES', `Grade report — ${d.section.subject.code}`);
    const verifyUrl = `${WEB_BASE}/verify/${reportNumber}`;
    const qrPng = Buffer.from((await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 })).split(',')[1], 'base64');

    // Landscape: rubric-per-student score sheets typically need more columns
    // than an A4 portrait page comfortably fits.
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const th = FONT_TH(); const thBold = FONT_TH_BOLD();
    if (th) doc.registerFont('TH', th);
    if (thBold) doc.registerFont('THB', thBold);
    const F = th ? 'TH' : 'Helvetica'; const FB = thBold ? 'THB' : 'Helvetica-Bold';
    const pageW = doc.page.width; const left = 36; const right = pageW - 36;

    const uniLogo = LOGO_UNIVERSITY(); const facLogo = LOGO_FACULTY();
    if (uniLogo) doc.image(uniLogo, left, 30, { width: 44 });
    if (facLogo) doc.image(facLogo, right - 44, 28, { width: 44 });
    doc.font(FB).fontSize(16).fillColor('#26303f').text(d.university?.nameTh ?? 'University', 88, 34, { width: pageW - 176, align: 'center' });
    doc.font(FB).fontSize(13).fillColor('#0e2a4a').text(d.faculty?.nameTh ?? 'Faculty of Nursing', 88, 53, { width: pageW - 176, align: 'center' });
    doc.font(F).fontSize(12).fillColor('#4a5666')
      .text(`รายงานผลการเรียนราย Section (Section Grade Report) — ${d.section.subject.code} ${d.section.subject.nameTh ?? d.section.subject.nameEn} · Sec ${d.section.sectionNo}`, 88, 71, { width: pageW - 176, align: 'center' });
    doc.moveTo(left, 94).lineTo(right, 94).strokeColor('#ff8a4c').lineWidth(1.5).stroke();
    doc.font(F).fontSize(10).fillColor('#4a5666').text(`เลขที่รายงาน: ${reportNumber}    ออกเมื่อ: ${this.thaiDateTime(new Date())}`, left, 100);

    // Table geometry — R1..Rn columns are equal width; a legend below the
    // table maps them to full rubric names (keeps columns readable at any
    // rubric count instead of squeezing long names into narrow cells).
    let y = 122;
    const fixedW = { no: 22, code: 62, name: 120, total: 46, grade: 44 };
    const rubricColW = Math.max(42, (right - left - fixedW.no - fixedW.code - fixedW.name - fixedW.total - fixedW.grade) / Math.max(1, d.rubrics.length));
    const colX: number[] = [left];
    colX.push(colX[0] + fixedW.no);
    colX.push(colX[1] + fixedW.code);
    colX.push(colX[2] + fixedW.name);
    const rubricStart = 3;
    for (let i = 0; i < d.rubrics.length; i++) colX.push(colX[rubricStart + i] + rubricColW);
    const totalCol = colX.length - 1;
    colX.push(colX[totalCol] + fixedW.total);
    const gradeCol = colX.length - 1;
    colX.push(colX[gradeCol] + fixedW.grade);

    const headerLabels = ['#', 'รหัส', 'ชื่อ-สกุล', ...d.rubrics.map((_, i) => `R${i + 1}`), 'รวม', 'เกรด'];
    const drawHeader = (yy: number) => {
      doc.roundedRect(left, yy - 4, right - left, 20, 3).fill('#0e7c7b');
      doc.font(FB).fontSize(9).fillColor('#fff');
      headerLabels.forEach((h, i) => doc.text(h, colX[i] + 3, yy, { width: colX[i + 1] - colX[i] - 5, align: i >= rubricStart ? 'center' : 'left' }));
      return yy + 20;
    };
    y = drawHeader(y);
    doc.font(F).fontSize(9);
    d.students.forEach((s, i) => {
      if (y > doc.page.height - 100) { doc.addPage(); y = drawHeader(40); doc.font(F).fontSize(9); }
      if (i % 2 === 1) { doc.rect(left, y - 3, right - left, 17).fill('#f6f8fb'); }
      doc.fillColor('#26303f');
      doc.text(String(i + 1), colX[0] + 3, y, { width: colX[1] - colX[0] - 5 });
      doc.text(s.studentCode, colX[1] + 3, y, { width: colX[2] - colX[1] - 5 });
      doc.text(this.personName(s.nameEn, s.nameTh), colX[2] + 3, y, { width: colX[3] - colX[2] - 5, lineBreak: false, ellipsis: true });
      d.rubrics.forEach((_, ri) => {
        const sc = s.scores[ri];
        doc.text(sc == null ? '—' : String(sc), colX[rubricStart + ri] + 3, y, { width: colX[rubricStart + ri + 1] - colX[rubricStart + ri] - 5, align: 'center' });
      });
      doc.font(FB).text(String(s.total), colX[totalCol] + 3, y, { width: colX[totalCol + 1] - colX[totalCol] - 5, align: 'center' });
      doc.text(s.grade ?? '—', colX[gradeCol] + 3, y, { width: colX[gradeCol + 1] - colX[gradeCol] - 5, align: 'center' });
      doc.font(F);
      y += 17;
    });

    // Legend
    y += 12;
    if (y > doc.page.height - 70) { doc.addPage(); y = 40; }
    doc.font(FB).fontSize(10).fillColor('#26303f').text('แบบประเมิน (Rubrics):', left, y); y += 15;
    doc.font(F).fontSize(9).fillColor('#4a5666');
    d.rubrics.forEach((r, i) => { doc.text(`R${i + 1} = ${r.nameTh ?? r.nameEn} (${r.weightPercent}%)`, left, y, { width: right - left }); y += 13; });

    // Signature + QR
    if (y > doc.page.height - 130) { doc.addPage(); y = 40; }
    const sy = y + 16;
    doc.image(qrPng, left, sy, { width: 66 });
    doc.font(F).fontSize(9).fillColor('#7c8798').text('สแกนเพื่อตรวจสอบ', left - 12, sy + 68, { width: 92, align: 'center', lineBreak: false });
    doc.font(F).fontSize(12).fillColor('#26303f');
    doc.text('.................................................', right - 200, sy + 22, { width: 200, align: 'center', lineBreak: false });
    doc.text('ผู้รับรอง / Authorised signature', right - 200, sy + 40, { width: 200, align: 'center', lineBreak: false });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      this.watermark(doc, F);
      doc.page.margins.bottom = 0;
      doc.font(F).fontSize(8).fillColor('#a0aab8')
        .text(`Generated by ClassWeb · ${reportNumber} · verify at ${verifyUrl} · หน้า ${i + 1}/${range.count}`, left, doc.page.height - 30, { width: right - left, align: 'center', lineBreak: false });
    }
    doc.flushPages();

    doc.end();
    const buffer = await done;
    await this.storeContent(reportNumber, buffer, 'application/pdf');
    return { buffer, reportNumber };
  }

  async sectionGradesCsv(user: AuthenticatedUser, sectionId: string, byId?: string, byName?: string): Promise<{ content: string; reportNumber: string }> {
    const universityId = user.universityId;
    const d = await this.gatherSectionGrades(user, sectionId);
    const checksum = createHash('sha256').update(JSON.stringify({ sectionId, n: d.students.length })).digest('hex');
    const reportNumber = await this.register(universityId, 'CSV', checksum, byId, byName, 'SECTION_GRADES', `Grade report — ${d.section.subject.code}`);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rubricHeaders = d.rubrics.map((r) => `${r.nameEn} (${r.weightPercent}%)`);
    const rows: string[][] = [
      ['Report No.', reportNumber],
      ['Section', `${d.section.subject.code} · ${d.section.sectionNo}`],
      [],
      ['#', 'Student code', 'Name (EN)', 'Name (TH)', ...rubricHeaders, 'Total', 'Grade', 'GPA'],
      ...d.students.map((s, i) => [
        String(i + 1), s.studentCode, s.nameEn, s.nameTh ?? '',
        ...s.scores.map((sc) => (sc == null ? '' : String(sc))),
        String(s.total), s.grade ?? '', s.gpa != null ? String(s.gpa) : '',
      ]),
    ];
    return { content: '﻿' + rows.map((r) => r.map((c) => esc(String(c))).join(',')).join('\n'), reportNumber };
  }

  async sectionGradesXlsx(user: AuthenticatedUser, sectionId: string, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const universityId = user.universityId;
    const d = await this.gatherSectionGrades(user, sectionId);
    const checksum = createHash('sha256').update(JSON.stringify({ sectionId, n: d.students.length })).digest('hex');
    const reportNumber = await this.register(universityId, 'XLSX', checksum, byId, byName, 'SECTION_GRADES', `Grade report — ${d.section.subject.code}`);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Grades');
    ws.addRow([`${d.section.subject.code} · Section ${d.section.sectionNo}`]);
    ws.addRow([`Report No.: ${reportNumber}`]);
    ws.addRow([`Generated: ${this.thaiDateTime(new Date())}`]);
    ws.addRow([]);
    const rubricHeaders = d.rubrics.map((r) => `${r.nameEn} (${r.weightPercent}%)`);
    const header = ws.addRow(['#', 'Student code', 'Name (EN)', 'Name (TH)', ...rubricHeaders, 'Total', 'Grade', 'GPA']);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7C7B' } }; });
    d.students.forEach((s, i) => ws.addRow([i + 1, s.studentCode, s.nameEn, s.nameTh ?? '', ...s.scores.map((sc) => sc ?? ''), s.total, s.grade ?? '', s.gpa ?? '']));
    ws.columns.forEach((c) => { c.width = 16; });
    ws.getColumn(3).width = 22; ws.getColumn(4).width = 22;
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), reportNumber };
  }

  // ---- Grade reports: per-student breakdown -------------------------------

  async studentGradePdf(user: AuthenticatedUser, studentId: string, sectionId: string, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const universityId = user.universityId;
    const [university, faculty, section, summary] = await Promise.all([
      this.prisma.university.findUnique({ where: { id: universityId }, select: { nameEn: true, nameTh: true } }),
      this.prisma.faculty.findFirst({ where: { universityId, code: 'NURSING' }, select: { nameEn: true, nameTh: true } }),
      this.prisma.section.findFirst({ where: { id: sectionId, universityId, deletedAt: null }, select: { sectionNo: true, subject: { select: { code: true, nameEn: true, nameTh: true } } } }),
      this.assessment.studentSummary(user, studentId, sectionId),
    ]);
    if (!section) throw new NotFoundException('Section not found in this tenant');

    const checksum = createHash('sha256').update(JSON.stringify({ studentId, sectionId, total: summary.total })).digest('hex');
    const reportNumber = await this.register(universityId, 'PDF', checksum, byId, byName, 'STUDENT_GRADE', `Grade report ${summary.student.studentCode}`);
    const verifyUrl = `${WEB_BASE}/verify/${reportNumber}`;
    const qrPng = Buffer.from((await QRCode.toDataURL(verifyUrl, { margin: 1, width: 200 })).split(',')[1], 'base64');

    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const th = FONT_TH(); const thBold = FONT_TH_BOLD();
    if (th) doc.registerFont('TH', th);
    if (thBold) doc.registerFont('THB', thBold);
    const F = th ? 'TH' : 'Helvetica'; const FB = thBold ? 'THB' : 'Helvetica-Bold';
    const pageW = doc.page.width; const left = 40; const right = pageW - 40;

    const uniLogo = LOGO_UNIVERSITY(); const facLogo = LOGO_FACULTY();
    if (uniLogo) doc.image(uniLogo, left, 38, { width: 50 });
    if (facLogo) doc.image(facLogo, right - 50, 36, { width: 50 });
    doc.font(FB).fontSize(18).fillColor('#26303f').text(university?.nameTh ?? 'University', 100, 44, { width: pageW - 200, align: 'center' });
    doc.font(FB).fontSize(15).fillColor('#0e2a4a').text(faculty?.nameTh ?? 'Faculty of Nursing', 100, 66, { width: pageW - 200, align: 'center' });
    doc.font(F).fontSize(14).fillColor('#4a5666').text('รายงานผลการเรียนรายบุคคล (Individual Grade Report)', 100, 86, { width: pageW - 200, align: 'center' });
    doc.moveTo(left, 112).lineTo(right, 112).strokeColor('#ff8a4c').lineWidth(2).stroke();

    let y = 122;
    doc.font(F).fontSize(12).fillColor('#4a5666').text(`เลขที่รายงาน: ${reportNumber}    ออกเมื่อ: ${this.thaiDateTime(new Date())}`, left, y);
    y += 22;

    doc.roundedRect(left, y, right - left, 78, 10).fillAndStroke('#fff6ee', '#ffd9bf');
    doc.fillColor('#26303f').font(FB).fontSize(14).text(`${this.personName(summary.student.nameEn, summary.student.nameTh)}  (${summary.student.studentCode})`, left + 14, y + 10);
    doc.font(F).fontSize(12).fillColor('#4a5666')
      .text(`หลักสูตร: ${summary.student.program.code} · รายวิชา: ${section.subject.code} ${section.subject.nameTh ?? section.subject.nameEn} · Sec ${section.sectionNo}`, left + 14, y + 32);
    const gradeText = summary.grade ? `${summary.grade.grade} (${summary.grade.gpa.toFixed(2)} ${summary.grade.label})` : '—';
    doc.font(FB).fontSize(13).fillColor('#26303f').text(`คะแนนรวม: ${summary.total}/100    เกรด: ${gradeText}`, left + 14, y + 52);
    y += 96;

    // Rubric breakdown table
    doc.font(FB).fontSize(14).fillColor('#26303f').text('รายละเอียดคะแนนแยกตามแบบประเมิน (Score breakdown)', left, y); y += 22;
    // Column widths as offsets from `left`. The status column needs room for
    // Thai text ("ยังไม่ให้คะแนน") and the last (contribution) column must fit
    // decimals like "55.99" — an earlier version left it only ~9pt wide,
    // which wrapped numbers onto multiple lines.
    const cols = [left, left + 210, left + 265, left + 320, left + 420];
    doc.roundedRect(left, y - 4, right - left, 20, 4).fill('#0e7c7b');
    doc.font(FB).fontSize(11).fillColor('#fff');
    ['แบบประเมิน', 'น้ำหนัก', 'คะแนน', 'สถานะ', 'คิดเป็น'].forEach((h, i) => doc.text(h, cols[i] + 4, y, { width: (cols[i + 1] ?? right) - cols[i] - 6 }));
    y += 20;
    doc.font(F).fontSize(11).fillColor('#26303f');
    summary.rubrics.forEach((r, i) => {
      if (i % 2 === 1) { doc.rect(left, y - 3, right - left, 20).fill('#f6f8fb'); doc.fillColor('#26303f'); }
      doc.text(r.nameTh ?? r.nameEn, cols[0] + 4, y, { width: cols[1] - cols[0] - 6 });
      doc.text(`${r.weightPercent}%`, cols[1] + 4, y, { width: cols[2] - cols[1] - 6 });
      doc.text(r.scorePercent != null ? `${r.scorePercent}` : '—', cols[2] + 4, y, { width: cols[3] - cols[2] - 6 });
      doc.text(r.graded ? 'ให้คะแนนแล้ว' : 'ยังไม่ให้คะแนน', cols[3] + 4, y, { width: cols[4] - cols[3] - 6 });
      doc.text(`${r.contribution}`, cols[4] + 4, y, { width: right - cols[4] - 6 });
      y += 20;
    });
    y += 6;
    doc.font(FB).fontSize(12).fillColor('#26303f').text(`รวม (Total): ${summary.total}/100`, left, y); y += 20;

    // Signature + QR
    if (y > doc.page.height - 170) { doc.addPage(); y = 60; }
    const sy = y + 20;
    doc.image(qrPng, left, sy, { width: 78 });
    doc.font(F).fontSize(10).fillColor('#7c8798').text('สแกนเพื่อตรวจสอบ', left - 15, sy + 80, { width: 108, align: 'center', lineBreak: false });
    doc.font(F).fontSize(13).fillColor('#26303f');
    doc.text('.................................................', right - 220, sy + 28, { width: 220, align: 'center', lineBreak: false });
    doc.text('ผู้รับรอง / Authorised signature', right - 220, sy + 46, { width: 220, align: 'center', lineBreak: false });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      this.watermark(doc, F);
      doc.page.margins.bottom = 0;
      doc.font(F).fontSize(9).fillColor('#a0aab8')
        .text(`Generated by ClassWeb · ${reportNumber} · verify at ${verifyUrl} · หน้า ${i + 1}/${range.count}`, left, doc.page.height - 40, { width: right - left, align: 'center', lineBreak: false });
    }
    doc.flushPages();

    doc.end();
    const buffer = await done;
    await this.storeContent(reportNumber, buffer, 'application/pdf');
    return { buffer, reportNumber };
  }

  async studentGradeCsv(user: AuthenticatedUser, studentId: string, sectionId: string, byId?: string, byName?: string): Promise<{ content: string; reportNumber: string }> {
    const universityId = user.universityId;
    const summary = await this.assessment.studentSummary(user, studentId, sectionId);
    const checksum = createHash('sha256').update(JSON.stringify({ studentId, sectionId, total: summary.total })).digest('hex');
    const reportNumber = await this.register(universityId, 'CSV', checksum, byId, byName, 'STUDENT_GRADE', `Grade report ${summary.student.studentCode}`);
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows: string[][] = [
      ['Report No.', reportNumber],
      ['Student', `${summary.student.studentCode} ${summary.student.nameEn}`],
      ['Program', summary.student.program.code],
      ['Total', String(summary.total)],
      ['Grade', summary.grade ? `${summary.grade.grade} (${summary.grade.gpa})` : ''],
      [],
      ['Rubric', 'Weight %', 'Score %', 'Graded', 'Contribution'],
      ...summary.rubrics.map((r) => [r.nameEn, String(r.weightPercent), r.scorePercent != null ? String(r.scorePercent) : '', r.graded ? 'Yes' : 'No', String(r.contribution)]),
    ];
    return { content: '﻿' + rows.map((r) => r.map((c) => esc(String(c))).join(',')).join('\n'), reportNumber };
  }

  async studentGradeXlsx(user: AuthenticatedUser, studentId: string, sectionId: string, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const universityId = user.universityId;
    const summary = await this.assessment.studentSummary(user, studentId, sectionId);
    const checksum = createHash('sha256').update(JSON.stringify({ studentId, sectionId, total: summary.total })).digest('hex');
    const reportNumber = await this.register(universityId, 'XLSX', checksum, byId, byName, 'STUDENT_GRADE', `Grade report ${summary.student.studentCode}`);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Grades');
    ws.addRow([`${this.personName(summary.student.nameEn, summary.student.nameTh)} (${summary.student.studentCode})`]);
    ws.addRow([`Report No.: ${reportNumber}`]);
    ws.addRow([`Total: ${summary.total}/100  ·  Grade: ${summary.grade ? summary.grade.grade + ' (' + summary.grade.gpa + ')' : '-'}`]);
    ws.addRow([]);
    const header = ws.addRow(['Rubric', 'Weight %', 'Score %', 'Graded', 'Contribution']);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7C7B' } }; });
    summary.rubrics.forEach((r) => ws.addRow([r.nameEn, r.weightPercent, r.scorePercent ?? '', r.graded ? 'Yes' : 'No', r.contribution]));
    ws.columns.forEach((c) => { c.width = 20; });
    ws.getColumn(1).width = 40;
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), reportNumber };
  }
}
