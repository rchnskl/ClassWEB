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

export type ReportLang = 'th' | 'en';

function tierOf(rate: number): 'OK' | 'WARNING' | 'RISK' | 'CRITICAL' {
  if (rate < 60) return 'CRITICAL';
  if (rate < 70) return 'RISK';
  if (rate < 80) return 'WARNING';
  return 'OK';
}
const TIER_LABEL: Record<string, Record<ReportLang, string>> = {
  OK: { th: 'ปกติ', en: 'OK' },
  WARNING: { th: 'เฝ้าระวัง', en: 'Warning' },
  RISK: { th: 'เสี่ยง', en: 'At risk' },
  CRITICAL: { th: 'วิกฤต', en: 'Critical' },
};
const STATUS_LABEL: Record<string, Record<ReportLang, string>> = {
  PRESENT: { th: 'มาเรียน', en: 'Present' },
  LATE: { th: 'สาย', en: 'Late' },
  ABSENT: { th: 'ขาด', en: 'Absent' },
  EXCUSED: { th: 'ลาป่วย/ลากิจ', en: 'Excused' },
  LEAVE: { th: 'ลา', en: 'Leave' },
};

/** Picks the string for the report's selected language — every PDF label goes through this. */
function L(lang: ReportLang, th: string, en: string): string {
  return lang === 'en' ? en : th;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly assessment: AssessmentService,
  ) {}

  private formatDateTime(d: Date, lang: ReportLang): string {
    return lang === 'en'
      ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(d)
      : new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(d);
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

  /**
   * The name printed under "Authorised signature" and stored as a report's
   * generatedByName — resolved from the caller's Lecturer profile rather
   * than their login email, which isn't something you'd want on an official
   * document a student or auditor sees. Admin accounts have no Lecturer
   * profile to resolve, so they fall back to a role label instead of email.
   */
  async resolveGeneratorName(userId?: string, isAdmin?: boolean): Promise<string | undefined> {
    if (!userId) return undefined;
    const lecturer = await this.prisma.lecturer.findFirst({
      where: { userId }, select: { nameEn: true, nameTh: true },
    });
    if (lecturer) return this.personName(lecturer.nameEn, lecturer.nameTh);
    return isAdmin ? 'System Administrator' : undefined;
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
    const fontSize = 13;
    const { width, height } = doc.page;
    doc.save();
    doc.rotate(-30, { origin: [width / 2, height / 2] });
    doc.font(font).fontSize(fontSize).fillColor('#0e2a4a', 0.09);
    // Tile spacing was a fixed 260px guess against a ~90-character string — far
    // narrower than the text itself, so consecutive tiles overwrote each other
    // into an unreadable smear. Measure the real width and pad from that instead.
    const textWidth = doc.widthOfString(text);
    const stepX = textWidth + 90;
    const stepY = fontSize * 6.5;
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

  async attendancePdf(user: AuthenticatedUser, byId?: string, byName?: string, lang: ReportLang = 'th'): Promise<{ buffer: Buffer; reportNumber: string }> {
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

    // Header: logos + titles. QR lives up here (not near the signature at the
    // bottom) so a long at-risk table pushing content onto extra pages can
    // never separate the QR from page 1.
    const uniLogo = LOGO_UNIVERSITY(); const facLogo = LOGO_FACULTY();
    if (uniLogo) doc.image(uniLogo, left, 38, { width: 54 });
    doc.image(qrPng, right - 46, 36, { width: 46 });
    doc.font(F).fontSize(7).fillColor('#7c8798').text(L(lang, 'สแกนตรวจสอบ', 'Scan to verify'), right - 60, 84, { width: 74, align: 'center', lineBreak: false });
    if (facLogo) doc.image(facLogo, right - 108, 36, { width: 54 });
    doc.font(FB).fontSize(20).fillColor('#26303f')
      .text((lang === 'en' ? university?.nameEn : university?.nameTh) ?? university?.nameEn ?? 'University', 100, 42, { width: pageW - 240, align: 'center' });
    doc.font(FB).fontSize(17).fillColor('#0e2a4a')
      .text((lang === 'en' ? faculty?.nameEn : faculty?.nameTh) ?? faculty?.nameEn ?? 'Faculty of Nursing', 100, 68, { width: pageW - 240, align: 'center' });
    doc.font(F).fontSize(15).fillColor('#4a5666')
      .text(L(lang, 'รายงานสรุปการเข้าเรียน', 'Attendance Summary Report'), 100, 92, { width: pageW - 240, align: 'center' });

    doc.moveTo(left, 122).lineTo(right, 122).strokeColor('#ff8a4c').lineWidth(2).stroke();

    // Report number + generated time
    doc.font(F).fontSize(13).fillColor('#4a5666');
    doc.text(`${L(lang, 'เลขที่รายงาน', 'Report No.')}: ${reportNumber}`, left, 130);
    doc.text(`${L(lang, 'ออกรายงานเมื่อ', 'Generated')}: ${this.formatDateTime(new Date(), lang)}`, left, 148);

    // Summary box
    let y = 178;
    doc.roundedRect(left, y, right - left, 66, 10).fillAndStroke('#fff6ee', '#ffd9bf');
    doc.fillColor('#26303f').font(FB).fontSize(15).text(L(lang, 'สรุปภาพรวม', 'Summary'), left + 14, y + 8);
    doc.font(F).fontSize(14).fillColor('#4a5666');
    const rate = overview.overallRate ?? 0;
    doc.text(`${L(lang, 'เข้าเรียนโดยรวม', 'Overall attendance')}: ${rate}%`, left + 14, y + 30);
    doc.text(
      `${L(lang, 'มาเรียน', 'Present')} ${overview.totals.present} · ${L(lang, 'สาย', 'Late')} ${overview.totals.late} · ${L(lang, 'ขาด', 'Absent')} ${overview.totals.absent}  (${L(lang, 'รวม', 'Total')} ${overview.totals.records} ${L(lang, 'รายการ', 'records')})`,
      left + 180, y + 30,
    );
    doc.text(
      `${L(lang, 'นักศึกษากลุ่มเสี่ยง', 'Students at risk')}: <80% = ${overview.risk.below80} · <70% = ${overview.risk.below70} · <60% = ${overview.risk.below60}`,
      left + 14, y + 46,
    );

    // At-risk table
    y += 86;
    doc.font(FB).fontSize(15).fillColor('#26303f').text(L(lang, 'รายชื่อนักศึกษากลุ่มเสี่ยง', 'Students at Risk'), left, y);
    y += 24;
    const cols = [left, left + 30, left + 130, left + 330, left + 420];
    const headers = [
      L(lang, 'ลำดับ', '#'), L(lang, 'รหัส', 'Code'), L(lang, 'ชื่อ-สกุล', 'Name'),
      L(lang, 'เข้าเรียน %', 'Rate %'), L(lang, 'สถานะ', 'Status'),
    ];
    doc.roundedRect(left, y - 4, right - left, 22, 4).fill('#0e7c7b');
    doc.font(FB).fontSize(13).fillColor('#ffffff');
    headers.forEach((h, i) => doc.text(h, cols[i] + 4, y, { width: (cols[i + 1] ?? right) - cols[i] - 6 }));
    y += 22;
    doc.font(F).fontSize(13).fillColor('#26303f');
    if (overview.atRisk.length === 0) {
      doc.text(L(lang, '— ไม่มีนักศึกษากลุ่มเสี่ยง —', '— No students at risk —'), left + 4, y + 2); y += 22;
    } else {
      overview.atRisk.forEach((s, i) => {
        if (i % 2 === 1) doc.rect(left, y - 3, right - left, 20).fill('#f6f8fb').fillColor('#26303f');
        doc.fillColor('#26303f');
        doc.text(String(i + 1), cols[0] + 4, y, { width: cols[1] - cols[0] - 6 });
        doc.text(s.studentCode, cols[1] + 4, y, { width: cols[2] - cols[1] - 6 });
        doc.text(this.personName(s.nameEn, s.nameTh), cols[2] + 4, y, { width: cols[3] - cols[2] - 6, lineBreak: false, ellipsis: true });
        doc.text(`${s.rate}%`, cols[3] + 4, y, { width: cols[4] - cols[3] - 6 });
        doc.text(TIER_LABEL[s.tier]?.[lang] ?? s.tier, cols[4] + 4, y, { width: right - cols[4] - 6 });
        y += 20;
      });
    }

    // Signature — centered; QR moved to the header so this block no longer
    // needs to share the footer with it (lineBreak:false avoids accidental
    // pagination when text sits near the bottom margin).
    const footY = doc.page.height - 100;
    doc.font(F).fontSize(14).fillColor('#26303f');
    doc.text(L(lang, 'ผู้รับรอง', 'Authorised signature'), left, footY, { width: right - left, align: 'center', lineBreak: false });
    if (byName) doc.font(FB).fontSize(13).text(byName, left, footY + 20, { width: right - left, align: 'center', lineBreak: false });

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
    ws.addRow([`Generated: ${this.formatDateTime(new Date(), 'th')}`]);
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

  async studentPdf(universityId: string, studentId: string, byId?: string, byName?: string, lang: ReportLang = 'th'): Promise<{ buffer: Buffer; reportNumber: string }> {
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

    // Header. QR sits up here rather than after the (variable-length) session
    // log, so it's always on page 1 regardless of how many terms of history
    // this student has.
    const uniLogo = LOGO_UNIVERSITY(); const facLogo = LOGO_FACULTY();
    if (uniLogo) doc.image(uniLogo, left, 38, { width: 50 });
    doc.image(qrPng, right - 44, 36, { width: 44 });
    doc.font(F).fontSize(7).fillColor('#7c8798').text(L(lang, 'สแกนตรวจสอบ', 'Scan to verify'), right - 58, 82, { width: 72, align: 'center', lineBreak: false });
    if (facLogo) doc.image(facLogo, right - 102, 36, { width: 50 });
    doc.font(FB).fontSize(18).fillColor('#26303f').text((lang === 'en' ? d.university?.nameEn : d.university?.nameTh) ?? 'University', 100, 44, { width: pageW - 230, align: 'center' });
    doc.font(FB).fontSize(15).fillColor('#0e2a4a').text((lang === 'en' ? d.faculty?.nameEn : d.faculty?.nameTh) ?? 'Faculty of Nursing', 100, 66, { width: pageW - 230, align: 'center' });
    doc.font(F).fontSize(14).fillColor('#4a5666').text(L(lang, 'รายงานการเข้าเรียนรายบุคคล', 'Individual Attendance Report'), 100, 86, { width: pageW - 230, align: 'center' });
    doc.moveTo(left, 112).lineTo(right, 112).strokeColor('#ff8a4c').lineWidth(2).stroke();

    // Student info + summary box
    let y = 122;
    doc.font(F).fontSize(12).fillColor('#4a5666').text(`${L(lang, 'เลขที่รายงาน', 'Report No.')}: ${reportNumber}    ${L(lang, 'ออกเมื่อ', 'Generated')}: ${this.formatDateTime(new Date(), lang)}`, left, y);
    y += 22;
    doc.roundedRect(left, y, right - left, 78, 10).fillAndStroke('#fff6ee', '#ffd9bf');
    doc.fillColor('#26303f').font(FB).fontSize(14).text(`${this.personName(d.student.nameEn, d.student.nameTh)}  (${d.student.studentCode})`, left + 14, y + 10);
    doc.font(F).fontSize(12).fillColor('#4a5666');
    doc.text(
      `${L(lang, 'หลักสูตร', 'Program')}: ${d.student.program.code} · ${L(lang, 'สถานะ', 'Status')}: ${d.student.status}${d.student.admissionYear ? ` · ${L(lang, 'ปีที่เข้า', 'Admission year')}: ${d.student.admissionYear}` : ''}`,
      left + 14, y + 32,
    );
    doc.font(FB).fontSize(13).fillColor('#26303f')
      .text(
        `${L(lang, 'เข้าเรียนโดยรวม', 'Overall attendance')}: ${d.rate}%  (${TIER_LABEL[d.tier]?.[lang] ?? d.tier})    ${L(lang, 'มาเรียน', 'Present')} ${d.present} · ${L(lang, 'สาย', 'Late')} ${d.late} · ${L(lang, 'ขาด', 'Absent')} ${d.absent}  ${L(lang, 'รวม', 'Total')} ${d.total} ${L(lang, 'คาบ', 'sessions')}`,
        left + 14, y + 52,
      );
    y += 96;

    // Per-subject breakdown
    doc.font(FB).fontSize(14).fillColor('#26303f').text(L(lang, 'สรุปแยกรายวิชา', 'By Subject'), left, y); y += 22;
    const sc = [left, left + 90, left + 300, left + 360, left + 420, left + 480];
    doc.roundedRect(left, y - 4, right - left, 20, 4).fill('#0e7c7b');
    doc.font(FB).fontSize(11).fillColor('#fff');
    [L(lang, 'รหัสวิชา', 'Code'), L(lang, 'ชื่อวิชา', 'Subject'), L(lang, 'มา', 'P'), L(lang, 'สาย', 'L'), L(lang, 'ขาด', 'A'), L(lang, 'เข้าเรียน%', 'Rate%')]
      .forEach((h, i) => doc.text(h, sc[i] + 3, y, { width: (sc[i + 1] ?? right) - sc[i] - 5 }));
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
    doc.font(FB).fontSize(14).fillColor('#26303f').text(L(lang, 'บันทึกการเข้าเรียนรายคาบ', 'Session Log'), left, y); y += 22;
    const lc = [left, left + 150, left + 320];
    const drawLogHeader = (yy: number) => {
      doc.roundedRect(left, yy - 4, right - left, 20, 4).fill('#0e7c7b');
      doc.font(FB).fontSize(11).fillColor('#fff');
      [L(lang, 'วันที่', 'Date'), L(lang, 'รายวิชา', 'Subject'), L(lang, 'สถานะ', 'Status')].forEach((h, i) => doc.text(h, lc[i] + 3, yy, { width: (lc[i + 1] ?? right) - lc[i] - 5 }));
      return yy + 20;
    };
    y = drawLogHeader(y);
    doc.font(F).fontSize(11).fillColor('#26303f');
    const fmtDate = (dt: Date) => (lang === 'en'
      ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(dt))
      : new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium', timeZone: 'Asia/Bangkok' }).format(new Date(dt)));
    d.log.forEach((row, i) => {
      if (y > doc.page.height - 80) { doc.addPage(); y = 50; y = drawLogHeader(y); doc.font(F).fontSize(11).fillColor('#26303f'); }
      if (i % 2 === 1) { doc.rect(left, y - 3, right - left, 18).fill('#f6f8fb'); doc.fillColor('#26303f'); }
      doc.text(fmtDate(row.date), lc[0] + 3, y, { width: lc[1] - lc[0] - 5 });
      doc.text(row.subject, lc[1] + 3, y, { width: lc[2] - lc[1] - 5 });
      doc.text(STATUS_LABEL[row.status]?.[lang] ?? row.status, lc[2] + 3, y);
      y += 18;
    });

    // Signature (flow after content) — centered now that the QR lives in the header.
    if (y > doc.page.height - 110) { doc.addPage(); y = 60; }
    const sy = y + 20;
    doc.font(F).fontSize(13).fillColor('#26303f');
    doc.text(L(lang, 'ผู้รับรอง', 'Authorised signature'), left, sy, { width: right - left, align: 'center', lineBreak: false });
    if (byName) doc.font(FB).fontSize(12).text(byName, left, sy + 18, { width: right - left, align: 'center', lineBreak: false });

    // Footer on every page. Zero the bottom margin while stamping so writing
    // near the page edge never auto-appends a blank page.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      this.watermark(doc, F);
      doc.page.margins.bottom = 0;
      doc.font(F).fontSize(9).fillColor('#a0aab8')
        .text(`Generated by ClassWeb · ${reportNumber} · verify at ${verifyUrl} · ${L(lang, 'หน้า', 'Page')} ${i + 1}/${range.count}`, left, doc.page.height - 40, { width: right - left, align: 'center', lineBreak: false });
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
      this.prisma.evaluation.findMany({
        where: { universityId, sectionId },
        select: {
          id: true, studentId: true, rubricId: true, scorePercent: true,
          scores: { select: { rubricItemId: true } },
        },
      }),
    ]);
    const scoreMap = new Map(evaluations.map((e) => [`${e.studentId}:${e.rubricId}`, e.scorePercent]));

    // For a multi-procedure checklist (LAB_MIDTERM-style — students draw one of
    // several procedures rather than doing all of them), a bare percentage
    // doesn't say which procedure it's from. Recover that from which
    // RubricItems actually got a score row: save() only ever writes a row for
    // an item that was rated, so the set of item ids an evaluation touched
    // maps straight back to the RubricSection(s)/procedure(s) examined.
    const sectionNameByItem = new Map<string, { nameEn: string; nameTh: string | null }>();
    const multiSectionRubrics = new Set<string>();
    for (const r of rubrics) {
      if (r.sections.length > 1) multiSectionRubrics.add(r.id);
      for (const s of r.sections) for (const it of s.items) sectionNameByItem.set(it.id, { nameEn: s.nameEn, nameTh: s.nameTh });
    }
    const examinedMap = new Map(evaluations.filter((e) => multiSectionRubrics.has(e.rubricId)).map((e) => {
      const names = new Map<string, string>(); // dedupe by nameEn, preserve th
      for (const sc of e.scores) {
        const sec = sectionNameByItem.get(sc.rubricItemId);
        if (sec) names.set(sec.nameEn, sec.nameTh ?? sec.nameEn);
      }
      return [`${e.studentId}:${e.rubricId}`, [...names.entries()]] as const;
    }));

    const students = summary.students.map((s) => ({
      ...s,
      scores: rubrics.map((r) => scoreMap.get(`${s.studentId}:${r.id}`) ?? null),
      examinedProcedures: rubrics.map((r) => examinedMap.get(`${s.studentId}:${r.id}`) ?? null),
    }));

    return { university, faculty, section, rubrics, students };
  }

  async sectionGradesPdf(user: AuthenticatedUser, sectionId: string, byId?: string, byName?: string, lang: ReportLang = 'th'): Promise<{ buffer: Buffer; reportNumber: string }> {
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

    // QR lives in the header, not the footer — a long student roster or rubric
    // legend used to push the QR/signature block onto its own extra page. Up
    // here it's guaranteed to land on page 1 no matter how the table paginates.
    const uniLogo = LOGO_UNIVERSITY(); const facLogo = LOGO_FACULTY();
    if (uniLogo) doc.image(uniLogo, left, 30, { width: 44 });
    doc.image(qrPng, right - 40, 26, { width: 40 });
    doc.font(F).fontSize(6.5).fillColor('#7c8798').text(L(lang, 'สแกนตรวจสอบ', 'Scan to verify'), right - 52, 67, { width: 64, align: 'center', lineBreak: false });
    if (facLogo) doc.image(facLogo, right - 96, 28, { width: 44 });
    doc.font(FB).fontSize(16).fillColor('#26303f').text((lang === 'en' ? d.university?.nameEn : d.university?.nameTh) ?? 'University', 88, 34, { width: pageW - 236, align: 'center' });
    doc.font(FB).fontSize(13).fillColor('#0e2a4a').text((lang === 'en' ? d.faculty?.nameEn : d.faculty?.nameTh) ?? 'Faculty of Nursing', 88, 53, { width: pageW - 236, align: 'center' });
    doc.font(F).fontSize(12).fillColor('#4a5666')
      .text(
        `${L(lang, 'รายงานผลการเรียนราย Section', 'Section Grade Report')} — ${d.section.subject.code} ${(lang === 'en' ? d.section.subject.nameEn : d.section.subject.nameTh) ?? d.section.subject.nameEn} · Sec ${d.section.sectionNo}`,
        88, 71, { width: pageW - 236, align: 'center' },
      );
    doc.moveTo(left, 94).lineTo(right, 94).strokeColor('#ff8a4c').lineWidth(1.5).stroke();
    doc.font(F).fontSize(10).fillColor('#4a5666').text(`${L(lang, 'เลขที่รายงาน', 'Report No.')}: ${reportNumber}    ${L(lang, 'ออกเมื่อ', 'Generated')}: ${this.formatDateTime(new Date(), lang)}`, left, 100);

    // Table geometry — R1..Rn columns are equal width, except a
    // multi-procedure checklist rubric (LAB_MIDTERM-style — students draw one
    // procedure by lot) gets extra width so the procedure name can print
    // right under its score, in the table itself, rather than a "*" pointing
    // at a key elsewhere on the page. A legend below the table still maps
    // R1..Rn to full rubric names.
    let y = 122;
    const fixedW = { no: 22, code: 62, name: 120, total: 46, grade: 44 };
    const multiSectionRubricIds = new Set(d.rubrics.filter((r) => r.sections.length > 1).map((r) => r.id));
    const multiColW = 100;
    const multiCount = d.rubrics.filter((r) => multiSectionRubricIds.has(r.id)).length;
    const singleCount = d.rubrics.length - multiCount;
    const singleColW = Math.max(36, (right - left - fixedW.no - fixedW.code - fixedW.name - fixedW.total - fixedW.grade - multiCount * multiColW) / Math.max(1, singleCount));
    const colX: number[] = [left];
    colX.push(colX[0] + fixedW.no);
    colX.push(colX[1] + fixedW.code);
    colX.push(colX[2] + fixedW.name);
    const rubricStart = 3;
    for (let i = 0; i < d.rubrics.length; i++) colX.push(colX[rubricStart + i] + (multiSectionRubricIds.has(d.rubrics[i].id) ? multiColW : singleColW));
    const totalCol = colX.length - 1;
    colX.push(colX[totalCol] + fixedW.total);
    const gradeCol = colX.length - 1;
    colX.push(colX[gradeCol] + fixedW.grade);
    // Every row reserves space for a second line (the procedure name) so row
    // height stays uniform whether or not that particular student has one.
    const rowH = multiCount > 0 ? 27 : 18;

    const headerLabels = ['#', L(lang, 'รหัส', 'Code'), L(lang, 'ชื่อ-สกุล', 'Name'), ...d.rubrics.map((_, i) => `R${i + 1}`), L(lang, 'รวม', 'Total'), L(lang, 'เกรด', 'Grade')];
    const drawHeader = (yy: number) => {
      doc.roundedRect(left, yy - 4, right - left, 21, 3).fill('#0e7c7b');
      doc.font(FB).fontSize(10).fillColor('#fff');
      headerLabels.forEach((h, i) => doc.text(h, colX[i] + 3, yy, { width: colX[i + 1] - colX[i] - 5, align: i >= rubricStart ? 'center' : 'left' }));
      return yy + 21;
    };
    y = drawHeader(y);
    doc.font(F).fontSize(10);
    d.students.forEach((s, i) => {
      if (y > doc.page.height - 100) { doc.addPage(); y = drawHeader(40); doc.font(F).fontSize(10); }
      if (i % 2 === 1) { doc.rect(left, y - 3, right - left, rowH).fill('#f6f8fb'); }
      doc.fillColor('#26303f');
      doc.text(String(i + 1), colX[0] + 3, y, { width: colX[1] - colX[0] - 5 });
      doc.text(s.studentCode, colX[1] + 3, y, { width: colX[2] - colX[1] - 5 });
      doc.text(this.personName(s.nameEn, s.nameTh), colX[2] + 3, y, { width: colX[3] - colX[2] - 5, lineBreak: false, ellipsis: true });
      d.rubrics.forEach((_, ri) => {
        const sc = s.scores[ri];
        const colW = colX[rubricStart + ri + 1] - colX[rubricStart + ri] - 5;
        doc.text(sc == null ? '—' : String(sc), colX[rubricStart + ri] + 3, y, { width: colW, align: 'center' });
        const procs = s.examinedProcedures[ri];
        if (procs) {
          doc.font(F).fontSize(7.5).fillColor('#7c8798')
            .text(procs.map(([en, th]) => (lang === 'en' ? en : th)).join(', '), colX[rubricStart + ri] + 3, y + 11, { width: colW, align: 'center', lineBreak: false, ellipsis: true });
          doc.font(F).fontSize(10).fillColor('#26303f');
        }
      });
      doc.font(FB).text(String(s.total), colX[totalCol] + 3, y, { width: colX[totalCol + 1] - colX[totalCol] - 5, align: 'center' });
      doc.text(s.grade ?? '—', colX[gradeCol] + 3, y, { width: colX[gradeCol + 1] - colX[gradeCol] - 5, align: 'center' });
      doc.font(F);
      y += rowH;
    });

    // Legend
    y += 12;
    if (y > doc.page.height - 70) { doc.addPage(); y = 40; }
    doc.font(FB).fontSize(11).fillColor('#26303f').text(L(lang, 'แบบประเมิน', 'Rubrics') + ':', left, y); y += 16;
    doc.font(F).fontSize(10).fillColor('#4a5666');
    d.rubrics.forEach((r, i) => { doc.text(`R${i + 1} = ${(lang === 'en' ? r.nameEn : r.nameTh) ?? r.nameEn} (${r.weightPercent}%)`, left, y, { width: right - left }); y += 14; });

    // Signature — QR already sits in the header, out of pagination's way.
    if (y > doc.page.height - 90) { doc.addPage(); y = 40; }
    const sy = y + 16;
    doc.font(F).fontSize(12).fillColor('#26303f');
    doc.text(L(lang, 'ผู้รับรอง', 'Authorised signature'), right - 200, sy, { width: 200, align: 'center', lineBreak: false });
    if (byName) doc.font(FB).fontSize(11).text(byName, right - 200, sy + 17, { width: 200, align: 'center', lineBreak: false });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      this.watermark(doc, F);
      doc.page.margins.bottom = 0;
      doc.font(F).fontSize(9).fillColor('#a0aab8')
        .text(`Generated by ClassWeb · ${reportNumber} · verify at ${verifyUrl} · ${L(lang, 'หน้า', 'Page')} ${i + 1}/${range.count}`, left, doc.page.height - 30, { width: right - left, align: 'center', lineBreak: false });
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
    ws.addRow([`Generated: ${this.formatDateTime(new Date(), 'th')}`]);
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

  async studentGradePdf(user: AuthenticatedUser, studentId: string, sectionId: string, byId?: string, byName?: string, lang: ReportLang = 'th'): Promise<{ buffer: Buffer; reportNumber: string }> {
    const universityId = user.universityId;
    const [university, faculty, section, summary] = await Promise.all([
      this.prisma.university.findUnique({ where: { id: universityId }, select: { nameEn: true, nameTh: true } }),
      this.prisma.faculty.findFirst({ where: { universityId, code: 'NURSING' }, select: { nameEn: true, nameTh: true } }),
      this.prisma.section.findFirst({ where: { id: sectionId, universityId, deletedAt: null }, select: { subjectId: true, sectionNo: true, subject: { select: { code: true, nameEn: true, nameTh: true } } } }),
      this.assessment.studentSummary(user, studentId, sectionId),
    ]);
    if (!section) throw new NotFoundException('Section not found in this tenant');

    // Same "which procedure was this score from" recovery as sectionGradesPdf
    // — see the comment there. Only one student's worth of evaluations here.
    const [rubrics, evaluations] = await Promise.all([
      this.assessment.activeRubricsForSubject(universityId, section.subjectId),
      this.prisma.evaluation.findMany({
        where: { universityId, studentId, sectionId },
        select: { rubricId: true, scores: { select: { rubricItemId: true } } },
      }),
    ]);
    const sectionNameByItem = new Map<string, { nameEn: string; nameTh: string | null }>();
    const multiSectionRubrics = new Set<string>();
    for (const r of rubrics) {
      if (r.sections.length > 1) multiSectionRubrics.add(r.id);
      for (const s of r.sections) for (const it of s.items) sectionNameByItem.set(it.id, { nameEn: s.nameEn, nameTh: s.nameTh });
    }
    const examinedByRubric = new Map(evaluations.filter((e) => multiSectionRubrics.has(e.rubricId)).map((e) => {
      const names = new Map<string, string>();
      for (const sc of e.scores) {
        const sec = sectionNameByItem.get(sc.rubricItemId);
        if (sec) names.set(sec.nameEn, sec.nameTh ?? sec.nameEn);
      }
      return [e.rubricId, [...names.entries()]] as const;
    }));

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
    doc.image(qrPng, right - 44, 36, { width: 44 });
    doc.font(F).fontSize(7).fillColor('#7c8798').text(L(lang, 'สแกนตรวจสอบ', 'Scan to verify'), right - 58, 82, { width: 72, align: 'center', lineBreak: false });
    if (facLogo) doc.image(facLogo, right - 102, 36, { width: 50 });
    doc.font(FB).fontSize(18).fillColor('#26303f').text((lang === 'en' ? university?.nameEn : university?.nameTh) ?? 'University', 100, 44, { width: pageW - 230, align: 'center' });
    doc.font(FB).fontSize(15).fillColor('#0e2a4a').text((lang === 'en' ? faculty?.nameEn : faculty?.nameTh) ?? 'Faculty of Nursing', 100, 66, { width: pageW - 230, align: 'center' });
    doc.font(F).fontSize(14).fillColor('#4a5666').text(L(lang, 'รายงานผลการเรียนรายบุคคล', 'Individual Grade Report'), 100, 86, { width: pageW - 230, align: 'center' });
    doc.moveTo(left, 112).lineTo(right, 112).strokeColor('#ff8a4c').lineWidth(2).stroke();

    let y = 122;
    doc.font(F).fontSize(12).fillColor('#4a5666').text(`${L(lang, 'เลขที่รายงาน', 'Report No.')}: ${reportNumber}    ${L(lang, 'ออกเมื่อ', 'Generated')}: ${this.formatDateTime(new Date(), lang)}`, left, y);
    y += 22;

    doc.roundedRect(left, y, right - left, 78, 10).fillAndStroke('#fff6ee', '#ffd9bf');
    doc.fillColor('#26303f').font(FB).fontSize(14).text(`${this.personName(summary.student.nameEn, summary.student.nameTh)}  (${summary.student.studentCode})`, left + 14, y + 10);
    doc.font(F).fontSize(12).fillColor('#4a5666')
      .text(
        `${L(lang, 'หลักสูตร', 'Program')}: ${summary.student.program.code} · ${L(lang, 'รายวิชา', 'Subject')}: ${section.subject.code} ${(lang === 'en' ? section.subject.nameEn : section.subject.nameTh) ?? section.subject.nameEn} · Sec ${section.sectionNo}`,
        left + 14, y + 32,
      );
    const gradeText = summary.grade ? `${summary.grade.grade} (${summary.grade.gpa.toFixed(2)} ${summary.grade.label})` : '—';
    doc.font(FB).fontSize(13).fillColor('#26303f').text(`${L(lang, 'คะแนนรวม', 'Total score')}: ${summary.total}/100    ${L(lang, 'เกรด', 'Grade')}: ${gradeText}`, left + 14, y + 52);
    y += 96;

    // Rubric breakdown table
    doc.font(FB).fontSize(14).fillColor('#26303f').text(L(lang, 'รายละเอียดคะแนนแยกตามแบบประเมิน', 'Score Breakdown'), left, y); y += 22;
    // Column widths as offsets from `left`. The status column needs room for
    // Thai text ("ยังไม่ให้คะแนน") and the last (contribution) column must fit
    // decimals like "55.99" — an earlier version left it only ~9pt wide,
    // which wrapped numbers onto multiple lines.
    const cols = [left, left + 210, left + 265, left + 320, left + 420];
    doc.roundedRect(left, y - 4, right - left, 20, 4).fill('#0e7c7b');
    doc.font(FB).fontSize(11).fillColor('#fff');
    [L(lang, 'แบบประเมิน', 'Rubric'), L(lang, 'น้ำหนัก', 'Weight'), L(lang, 'คะแนน', 'Score'), L(lang, 'สถานะ', 'Status'), L(lang, 'คิดเป็น', 'Contribution')]
      .forEach((h, i) => doc.text(h, cols[i] + 4, y, { width: (cols[i + 1] ?? right) - cols[i] - 6 }));
    y += 20;
    doc.font(F).fontSize(11).fillColor('#26303f');
    summary.rubrics.forEach((r, i) => {
      // A multi-procedure checklist rubric (LAB_MIDTERM-style — students draw
      // one of several procedures) needs the procedure name printed, not just
      // a percentage: "83%" alone doesn't say whether that's from hand
      // hygiene or vital signs. Recovered from which RubricItems this
      // student's evaluation actually has score rows for.
      const procs = examinedByRubric.get(r.rubricId);
      const rowH = procs && procs.length > 0 ? 30 : 20;
      if (i % 2 === 1) { doc.rect(left, y - 3, right - left, rowH).fill('#f6f8fb'); doc.fillColor('#26303f'); }
      doc.text((lang === 'en' ? r.nameEn : r.nameTh) ?? r.nameEn, cols[0] + 4, y, { width: cols[1] - cols[0] - 6 });
      doc.text(`${r.weightPercent}%`, cols[1] + 4, y, { width: cols[2] - cols[1] - 6 });
      doc.text(r.scorePercent != null ? `${r.scorePercent}` : '—', cols[2] + 4, y, { width: cols[3] - cols[2] - 6 });
      doc.text(L(lang, r.graded ? 'ให้คะแนนแล้ว' : 'ยังไม่ให้คะแนน', r.graded ? 'Graded' : 'Not graded'), cols[3] + 4, y, { width: cols[4] - cols[3] - 6 });
      doc.text(`${r.contribution}`, cols[4] + 4, y, { width: right - cols[4] - 6 });
      if (procs && procs.length > 0) {
        doc.font(F).fontSize(9).fillColor('#7c8798')
          .text(`${L(lang, 'หัตถการที่สอบ', 'Procedure examined')}: ${procs.map(([en, th]) => (lang === 'en' ? en : th)).join(', ')}`, cols[0] + 4, y + 14, { width: right - cols[0] - 6, lineBreak: false, ellipsis: true });
        doc.font(F).fontSize(11).fillColor('#26303f');
      }
      y += rowH;
    });
    y += 6;
    doc.font(FB).fontSize(12).fillColor('#26303f').text(`${L(lang, 'รวม', 'Total')}: ${summary.total}/100`, left, y); y += 20;

    // Signature — centered; QR is up in the header.
    if (y > doc.page.height - 110) { doc.addPage(); y = 60; }
    const sy = y + 20;
    doc.font(F).fontSize(13).fillColor('#26303f');
    doc.text(L(lang, 'ผู้รับรอง', 'Authorised signature'), left, sy, { width: right - left, align: 'center', lineBreak: false });
    if (byName) doc.font(FB).fontSize(12).text(byName, left, sy + 18, { width: right - left, align: 'center', lineBreak: false });

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
