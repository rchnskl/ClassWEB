import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import ExcelJS from 'exceljs';
import { AuditAction, ReportFormat } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { FONT_TH, FONT_TH_BOLD, LOGO_FACULTY, LOGO_UNIVERSITY } from './report-assets';

const WEB_BASE = process.env.WEB_BASE_URL ?? 'http://localhost:3000';

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  private thaiDateTime(d: Date): string {
    return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
      dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Bangkok',
    }).format(d);
  }

  private newReportNumber(): string {
    const d = new Date();
    const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return `RPT-${ymd}-${randomBytes(3).toString('hex').toUpperCase()}`;
  }

  private async gather(universityId: string) {
    const [university, faculty, overview] = await Promise.all([
      this.prisma.university.findUnique({ where: { id: universityId }, select: { nameEn: true, nameTh: true, code: true } }),
      this.prisma.faculty.findFirst({ where: { universityId, code: 'NURSING' }, select: { nameEn: true, nameTh: true } }),
      this.analytics.overview(universityId),
    ]);
    return { university, faculty, overview };
  }

  private async register(universityId: string, format: ReportFormat, checksum: string, byId?: string, byName?: string) {
    const reportNumber = this.newReportNumber();
    await this.prisma.report.create({
      data: {
        universityId, reportNumber, format, checksum,
        type: 'ATTENDANCE_SUMMARY', title: 'Attendance Summary Report',
        generatedById: byId ?? null, generatedByName: byName ?? null,
      },
    });
    await this.prisma.auditLog.create({
      data: { universityId, userId: byId ?? null, action: AuditAction.EXPORT, entityType: 'Report', metadata: { reportNumber, format } },
    });
    return reportNumber;
  }

  async verify(reportNumber: string) {
    const report = await this.prisma.report.findUnique({
      where: { reportNumber },
      select: { reportNumber: true, type: true, title: true, format: true, generatedByName: true, createdAt: true, checksum: true, university: { select: { nameEn: true, nameTh: true } } },
    });
    if (!report) throw new NotFoundException('Report not found — this document could not be verified');
    return { valid: true, ...report };
  }

  // ---- PDF --------------------------------------------------------------

  async attendancePdf(universityId: string, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const { university, faculty, overview } = await this.gather(universityId);
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
        doc.text(s.nameTh ?? s.nameEn, cols[2] + 4, y, { width: cols[3] - cols[2] - 6 });
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
    return { buffer: await done, reportNumber };
  }

  // ---- CSV --------------------------------------------------------------

  async attendanceCsv(universityId: string, byId?: string, byName?: string): Promise<{ content: string; reportNumber: string }> {
    const { overview } = await this.gather(universityId);
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

  async attendanceXlsx(universityId: string, byId?: string, byName?: string): Promise<{ buffer: Buffer; reportNumber: string }> {
    const { university, faculty, overview } = await this.gather(universityId);
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
}
