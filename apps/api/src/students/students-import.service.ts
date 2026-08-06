import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomBytes } from 'node:crypto';
import { AuditAction, Gender, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/authenticated-user';
import { ImportDuplicateMode, ImportRowResult, ImportStudentsDto, ImportSummary } from './dto/import-student.dto';

/** Hard limits — an import is an interactive action, not a bulk migration tool. */
const MAX_ROWS = 1000;
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Accepted column headings, lower-cased. Real spreadsheets come from several
 * offices with different conventions (and in both languages), so headers are
 * matched by alias rather than by position — a column order change must not
 * silently import names into the code column.
 */
const HEADER_ALIASES: Record<string, string[]> = {
  studentCode: ['student code', 'studentcode', 'student id', 'studentid', 'code', 'id', 'no', 'รหัสนักศึกษา', 'รหัส', 'รหัส นศ.', 'รหัสนศ'],
  nameEn: ['name', 'name (en)', 'name en', 'nameen', 'english name', 'full name', 'ชื่อ-นามสกุล (อังกฤษ)', 'ชื่ออังกฤษ'],
  nameTh: ['name (th)', 'name th', 'nameth', 'thai name', 'ชื่อ-นามสกุล', 'ชื่อ-สกุล', 'ชื่อไทย', 'ชื่อ'],
  nickname: ['nickname', 'nick name', 'ชื่อเล่น'],
  gender: ['gender', 'sex', 'title', 'เพศ', 'คำนำหน้า'],
  email: ['email', 'e-mail', 'อีเมล', 'อีเมล์'],
  phone: ['phone', 'mobile', 'tel', 'telephone', 'เบอร์โทร', 'โทรศัพท์'],
  yearLevel: ['year', 'year level', 'yearlevel', 'ชั้นปี', 'ปี'],
};

const MALE_TOKENS = ['male', 'm', 'mr', 'mr.', 'ชาย', 'นาย'];
const FEMALE_TOKENS = ['female', 'f', 'ms', 'ms.', 'mrs', 'mrs.', 'miss', 'หญิง', 'นาง', 'นางสาว', 'น.ส.'];

@Injectable()
export class StudentsImportService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- template ----------------------------------------------------------

  /**
   * A blank workbook with the exact headers the parser understands. The
   * student-code column is formatted as text so Excel does not turn
   * "06812001" into the number 6812001 and drop the leading zero — the single
   * most common way a real roster import goes wrong.
   */
  async template(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Students');

    ws.columns = [
      { header: 'Student code', key: 'studentCode', width: 16 },
      { header: 'Name (EN)', key: 'nameEn', width: 30 },
      { header: 'Name (TH)', key: 'nameTh', width: 30 },
      { header: 'Nickname', key: 'nickname', width: 14 },
      { header: 'Gender', key: 'gender', width: 12 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Phone', key: 'phone', width: 16 },
      { header: 'Year', key: 'yearLevel', width: 8 },
    ];
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7C7B' } }; });
    ws.getColumn('studentCode').numFmt = '@';

    ws.addRow({
      studentCode: '6812001', nameEn: 'SOMSRI SUKSAN', nameTh: 'สมศรี สุขสันต์',
      nickname: 'Som', gender: 'MS.', email: 'somsri@au.edu', phone: '0812345678', yearLevel: 2,
    });
    ws.addRow({
      studentCode: '6812002', nameEn: 'ANAN PRASERT', nameTh: 'อนันต์ ประเสริฐ',
      nickname: '', gender: 'MR.', email: '', phone: '', yearLevel: 2,
    });

    const notes = wb.addWorksheet('Notes');
    notes.getColumn(1).width = 100;
    [
      'ClassWeb — student roster import',
      '',
      'Required: Student code, Name (EN). Everything else is optional.',
      'Gender accepts MR./MS./MALE/FEMALE/ชาย/หญิง — anything else is stored as unspecified.',
      'Year may be left blank; the year you pick in the import screen is then applied to every row.',
      'Keep the Student code column formatted as Text so leading zeros are preserved.',
      'Delete the two example rows before uploading.',
      `Maximum ${MAX_ROWS} rows per file.`,
    ].forEach((line) => notes.addRow([line]));

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ---- parsing helpers ---------------------------------------------------

  /** Robust cell → string: handles formulas, rich text, hyperlinks and numbers. */
  private cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') {
      // Integers must not come back as "6812001.0" or "6.812001e+6".
      return Number.isInteger(value) ? value.toFixed(0) : String(value).trim();
    }
    if (typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'object') {
      const v = value as unknown as Record<string, unknown>;
      if ('richText' in v && Array.isArray(v.richText)) {
        return (v.richText as { text: string }[]).map((r) => r.text).join('').trim();
      }
      if ('text' in v && typeof v.text === 'string') return v.text.trim();
      if ('result' in v) return this.cellText(v.result as ExcelJS.CellValue);
      if ('hyperlink' in v && typeof v.hyperlink === 'string') return v.hyperlink.trim();
    }
    return String(value).trim();
  }

  private toGender(raw: string): Gender {
    const v = raw.trim().toLowerCase().replace(/\s+/g, '');
    if (MALE_TOKENS.includes(v)) return 'MALE';
    if (FEMALE_TOKENS.includes(v)) return 'FEMALE';
    return 'UNSPECIFIED';
  }

  /** Locates the header row and maps our field names to column numbers. */
  private mapHeaders(ws: ExcelJS.Worksheet): { headerRow: number; columns: Record<string, number> } {
    // Scan the first few rows: real files often carry a title line above the table.
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const columns: Record<string, number> = {};
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        const text = this.cellText(cell.value).toLowerCase().replace(/\s+/g, ' ').trim();
        if (!text) return;
        for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
          if (columns[field] === undefined && aliases.includes(text)) columns[field] = col;
        }
      });
      if (columns.studentCode !== undefined && columns.nameEn !== undefined) {
        return { headerRow: r, columns };
      }
    }
    throw new BadRequestException(
      'Could not find the header row. The sheet needs a "Student code" column and a "Name (EN)" column — download the template to see the expected format.',
    );
  }

  // ---- import ------------------------------------------------------------

  async run(
    user: AuthenticatedUser,
    file: { buffer: Buffer; originalname?: string; size?: number },
    dto: ImportStudentsDto,
  ): Promise<ImportSummary> {
    if (!file?.buffer?.length) throw new BadRequestException('No file was uploaded');
    if ((file.size ?? file.buffer.length) > MAX_BYTES) {
      throw new BadRequestException(`File is larger than ${MAX_BYTES / 1024 / 1024} MB`);
    }

    const program = await this.prisma.program.findFirst({
      where: { id: dto.programId, deletedAt: null, faculty: { universityId: user.universityId } },
      select: { id: true },
    });
    if (!program) throw new BadRequestException('Program does not exist in this tenant');

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('That file could not be read as an Excel workbook (.xlsx)');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('The workbook has no sheets');

    const { headerRow, columns } = this.mapHeaders(ws);

    // ---- pass 1: read + shape ------------------------------------------
    const parsed: ImportRowResult[] = [];
    const seenCodes = new Map<string, number>();
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const at = (field: string) => (columns[field] ? this.cellText(row.getCell(columns[field]).value) : '');

      const studentCode = at('studentCode');
      const nameEn = at('nameEn');
      // Skip genuinely blank rows rather than reporting them as errors.
      if (!studentCode && !nameEn && !at('nameTh')) continue;

      if (parsed.length >= MAX_ROWS) {
        throw new BadRequestException(`This file has more than ${MAX_ROWS} rows — split it into smaller files`);
      }

      const errors: string[] = [];
      if (!studentCode) errors.push('Student code is missing');
      else if (studentCode.length < 3) errors.push('Student code is too short');
      if (!nameEn) errors.push('Name (EN) is missing');

      const yearRaw = at('yearLevel');
      let yearLevel: number | null = dto.yearLevel ?? null;
      if (yearRaw) {
        const n = Number(yearRaw);
        if (!Number.isInteger(n) || n < 1 || n > 8) errors.push(`Year "${yearRaw}" is not a whole number between 1 and 8`);
        else yearLevel = n;
      }

      const email = at('email');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push(`Email "${email}" is not a valid address`);

      if (studentCode) {
        const firstSeen = seenCodes.get(studentCode);
        if (firstSeen) errors.push(`Duplicate of row ${firstSeen} in this file`);
        else seenCodes.set(studentCode, r);
      }

      parsed.push({
        row: r,
        studentCode,
        nameEn,
        nameTh: at('nameTh') || null,
        nickname: at('nickname') || null,
        gender: at('gender') || null,
        email: email || null,
        phone: at('phone') || null,
        yearLevel,
        action: errors.length ? 'ERROR' : 'CREATE',
        errors,
      });
    }

    if (parsed.length === 0) throw new BadRequestException('The sheet has no data rows below the header');

    // ---- pass 2: reconcile against the existing roster -------------------
    const codes = [...seenCodes.keys()];
    const existing = await this.prisma.student.findMany({
      where: { universityId: user.universityId, studentCode: { in: codes }, deletedAt: null },
      select: { id: true, studentCode: true },
    });
    const existingByCode = new Map(existing.map((s) => [s.studentCode, s.id]));
    const onDuplicate = dto.onDuplicate ?? ImportDuplicateMode.SKIP;

    for (const p of parsed) {
      if (p.action === 'ERROR') continue;
      if (existingByCode.has(p.studentCode)) {
        p.action = onDuplicate === ImportDuplicateMode.UPDATE ? 'UPDATE' : 'SKIP';
        if (p.action === 'SKIP') p.errors.push('Already in the roster — left unchanged');
      }
    }

    const summary: ImportSummary = {
      fileName: file.originalname ?? 'upload.xlsx',
      totalRows: parsed.length,
      toCreate: parsed.filter((p) => p.action === 'CREATE').length,
      toUpdate: parsed.filter((p) => p.action === 'UPDATE').length,
      toSkip: parsed.filter((p) => p.action === 'SKIP').length,
      errors: parsed.filter((p) => p.action === 'ERROR').length,
      committed: false,
      rows: parsed,
    };

    if (!dto.commit) return summary;

    // A file with broken rows is rejected wholesale: a half-imported cohort is
    // worse than none, because nobody can tell which half landed.
    if (summary.errors > 0) {
      throw new BadRequestException(
        `${summary.errors} row(s) still have errors — fix the file and upload again. Nothing was imported.`,
      );
    }

    // ---- commit ----------------------------------------------------------
    const importBatch = `IMP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
    const stamp = { importBatch, importedAt: new Date().toISOString() } as Prisma.InputJsonValue;

    await this.prisma.$transaction(async (tx) => {
      const creates = parsed.filter((p) => p.action === 'CREATE');
      if (creates.length) {
        await tx.student.createMany({
          data: creates.map((p) => ({
            universityId: user.universityId,
            programId: dto.programId,
            studentCode: p.studentCode,
            nameEn: p.nameEn,
            nameTh: p.nameTh,
            nickname: p.nickname,
            gender: p.gender ? this.toGender(p.gender) : 'UNSPECIFIED',
            email: p.email,
            phone: p.phone,
            yearLevel: p.yearLevel,
            qrCode: `STU-${user.universityId.slice(-6)}-${p.studentCode}`,
            metadata: stamp,
          })),
          skipDuplicates: true,
        });
      }
      for (const p of parsed.filter((x) => x.action === 'UPDATE')) {
        await tx.student.update({
          where: { id: existingByCode.get(p.studentCode)! },
          data: {
            nameEn: p.nameEn,
            nameTh: p.nameTh,
            nickname: p.nickname,
            ...(p.gender ? { gender: this.toGender(p.gender) } : {}),
            ...(p.email ? { email: p.email } : {}),
            ...(p.phone ? { phone: p.phone } : {}),
            ...(p.yearLevel !== null ? { yearLevel: p.yearLevel } : {}),
            programId: dto.programId,
            metadata: stamp,
          },
        });
      }
    }, { timeout: 60_000, maxWait: 10_000 });

    await this.prisma.auditLog.create({
      data: {
        universityId: user.universityId, userId: user.id, action: AuditAction.IMPORT,
        entityType: 'Student',
        metadata: {
          importBatch,
          fileName: summary.fileName,
          programId: dto.programId,
          yearLevel: dto.yearLevel ?? null,
          created: summary.toCreate,
          updated: summary.toUpdate,
          skipped: summary.toSkip,
          onDuplicate,
        },
      },
    });

    return { ...summary, committed: true, importBatch };
  }
}
