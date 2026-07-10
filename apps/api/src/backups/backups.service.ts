import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Application-level backup: pg_dump/psql are not available to this app in
 * every deployment target (and aren't bundled with embedded-postgres either),
 * so instead we snapshot tenant *business* data as JSON via Prisma, in FK
 * dependency order. Auth/security/audit tables (User, RefreshToken, Role,
 * Permission, RolePermission, UserRole, AuditLog, Report, Backup itself,
 * GoogleCalendarConnection, Notification) are intentionally excluded — they
 * are either regenerable, sensitive, or meaningless across environments.
 */

const BACKUP_VERSION = 1;

interface Ctx {
  universityId: string;
  campusIds: string[];
  buildingIds: string[];
  facultyIds: string[];
  programIds: string[];
  subjectIds: string[];
  academicYearIds: string[];
  sectionIds: string[];
  classSessionIds: string[];
  enrollmentIds: string[];
  attendanceSessionIds: string[];
  rubricIds: string[];
  rubricSectionIds: string[];
  schemeIds: string[];
}

interface Step {
  table: string;
  fetch: (prisma: PrismaService, ctx: Ctx) => Promise<any[]>;
  collect?: (rows: any[], ctx: Ctx) => void;
  restore: (prisma: PrismaService, rows: any[]) => Promise<{ count: number }>;
}

const idsOf = (rows: any[]) => rows.map((r) => r.id as string);

const STEPS: Step[] = [
  {
    table: 'campus',
    fetch: (p, c) => p.campus.findMany({ where: { universityId: c.universityId } }),
    collect: (rows, c) => (c.campusIds = idsOf(rows)),
    restore: (p, rows) => p.campus.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'building',
    fetch: (p, c) => p.building.findMany({ where: { campusId: { in: c.campusIds } } }),
    collect: (rows, c) => (c.buildingIds = idsOf(rows)),
    restore: (p, rows) => p.building.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'room',
    fetch: (p, c) => p.room.findMany({ where: { buildingId: { in: c.buildingIds } } }),
    restore: (p, rows) => p.room.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'faculty',
    fetch: (p, c) => p.faculty.findMany({ where: { universityId: c.universityId } }),
    collect: (rows, c) => (c.facultyIds = idsOf(rows)),
    restore: (p, rows) => p.faculty.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'department',
    fetch: (p, c) => p.department.findMany({ where: { facultyId: { in: c.facultyIds } } }),
    restore: (p, rows) => p.department.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'program',
    fetch: (p, c) => p.program.findMany({ where: { facultyId: { in: c.facultyIds } } }),
    collect: (rows, c) => (c.programIds = idsOf(rows)),
    restore: (p, rows) => p.program.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'course',
    fetch: (p, c) => p.course.findMany({ where: { programId: { in: c.programIds } } }),
    restore: (p, rows) => p.course.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'subject',
    fetch: (p, c) => p.subject.findMany({ where: { programId: { in: c.programIds } } }),
    collect: (rows, c) => (c.subjectIds = idsOf(rows)),
    restore: (p, rows) => p.subject.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'academicYear',
    fetch: (p, c) => p.academicYear.findMany({ where: { universityId: c.universityId } }),
    collect: (rows, c) => (c.academicYearIds = idsOf(rows)),
    restore: (p, rows) => p.academicYear.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'semester',
    fetch: (p, c) => p.semester.findMany({ where: { academicYearId: { in: c.academicYearIds } } }),
    restore: (p, rows) => p.semester.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'lecturer',
    fetch: (p, c) => p.lecturer.findMany({ where: { universityId: c.universityId } }),
    restore: (p, rows) => p.lecturer.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'student',
    fetch: (p, c) => p.student.findMany({ where: { universityId: c.universityId } }),
    restore: (p, rows) => p.student.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'section',
    fetch: (p, c) => p.section.findMany({ where: { universityId: c.universityId } }),
    collect: (rows, c) => (c.sectionIds = idsOf(rows)),
    restore: (p, rows) => p.section.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'sectionLecturer',
    fetch: (p, c) => p.sectionLecturer.findMany({ where: { sectionId: { in: c.sectionIds } } }),
    restore: (p, rows) => p.sectionLecturer.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'sectionSchedule',
    fetch: (p, c) => p.sectionSchedule.findMany({ where: { sectionId: { in: c.sectionIds } } }),
    restore: (p, rows) => p.sectionSchedule.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'classSession',
    fetch: (p, c) => p.classSession.findMany({ where: { sectionId: { in: c.sectionIds } } }),
    collect: (rows, c) => (c.classSessionIds = idsOf(rows)),
    restore: (p, rows) => p.classSession.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'enrollment',
    fetch: (p, c) => p.enrollment.findMany({ where: { sectionId: { in: c.sectionIds } } }),
    collect: (rows, c) => (c.enrollmentIds = idsOf(rows)),
    restore: (p, rows) => p.enrollment.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'attendanceRecord',
    fetch: (p, c) => p.attendanceRecord.findMany({ where: { enrollmentId: { in: c.enrollmentIds } } }),
    restore: (p, rows) => p.attendanceRecord.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'attendanceRule',
    fetch: (p, c) => p.attendanceRule.findMany({ where: { universityId: c.universityId } }),
    restore: (p, rows) => p.attendanceRule.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'attendanceSession',
    fetch: (p, c) => p.attendanceSession.findMany({ where: { classSessionId: { in: c.classSessionIds } } }),
    collect: (rows, c) => (c.attendanceSessionIds = idsOf(rows)),
    restore: (p, rows) => p.attendanceSession.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'attendanceCheckIn',
    fetch: (p, c) => p.attendanceCheckIn.findMany({ where: { attendanceSessionId: { in: c.attendanceSessionIds } } }),
    restore: (p, rows) => p.attendanceCheckIn.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'calendarEvent',
    fetch: (p, c) => p.calendarEvent.findMany({ where: { universityId: c.universityId } }),
    restore: (p, rows) => p.calendarEvent.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'calendarEntry',
    fetch: (p, c) => p.calendarEntry.findMany({ where: { universityId: c.universityId } }),
    restore: (p, rows) => p.calendarEntry.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'studentNote',
    fetch: (p, c) => p.studentNote.findMany({ where: { universityId: c.universityId } }),
    restore: (p, rows) => p.studentNote.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'rubric',
    fetch: (p, c) => p.rubric.findMany({ where: { universityId: c.universityId } }),
    collect: (rows, c) => (c.rubricIds = idsOf(rows)),
    restore: (p, rows) => p.rubric.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'rubricSection',
    fetch: (p, c) => p.rubricSection.findMany({ where: { rubricId: { in: c.rubricIds } } }),
    collect: (rows, c) => (c.rubricSectionIds = idsOf(rows)),
    restore: (p, rows) => p.rubricSection.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'rubricItem',
    fetch: (p, c) => p.rubricItem.findMany({ where: { sectionId: { in: c.rubricSectionIds } } }),
    restore: (p, rows) => p.rubricItem.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'subjectRubric',
    fetch: (p, c) => p.subjectRubric.findMany({ where: { subjectId: { in: c.subjectIds } } }),
    restore: (p, rows) => p.subjectRubric.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'evaluation',
    fetch: (p, c) => p.evaluation.findMany({ where: { universityId: c.universityId } }),
    collect: (rows, c) => ((c as any).evaluationIds = idsOf(rows)),
    restore: (p, rows) => p.evaluation.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'evaluationScore',
    fetch: (p, c) => p.evaluationScore.findMany({ where: { evaluationId: { in: (c as any).evaluationIds ?? [] } } }),
    restore: (p, rows) => p.evaluationScore.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'gradeScheme',
    fetch: (p, c) => p.gradeScheme.findMany({ where: { universityId: c.universityId } }),
    collect: (rows, c) => (c.schemeIds = idsOf(rows)),
    restore: (p, rows) => p.gradeScheme.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'gradeBand',
    fetch: (p, c) => p.gradeBand.findMany({ where: { schemeId: { in: c.schemeIds } } }),
    restore: (p, rows) => p.gradeBand.createMany({ data: rows, skipDuplicates: true }),
  },
  {
    table: 'setting',
    fetch: (p, c) => p.setting.findMany({ where: { universityId: c.universityId } }),
    restore: (p, rows) => p.setting.createMany({ data: rows, skipDuplicates: true }),
  },
];

/** Recursively turn ISO-8601 date strings back into Date objects after JSON.parse. */
function reviveDates(value: any): any {
  if (Array.isArray(value)) return value.map(reviveDates);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = reviveDates(v);
    return out;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
    return new Date(value);
  }
  return value;
}

function storageDir(): string {
  const dir = join(__dirname, '..', '..', '..', '..', 'storage', 'backups');
  mkdirSync(dir, { recursive: true });
  return dir;
}

@Injectable()
export class BackupsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(universityId: string) {
    return this.prisma.backup.findMany({
      where: { universityId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async create(universityId: string, createdById: string | null, note?: string, type: 'MANUAL' | 'AUTOMATIC' = 'MANUAL') {
    const backup = await this.prisma.backup.create({
      data: { universityId, type, status: 'IN_PROGRESS', startedAt: new Date(), createdById, metadata: note ? { note } : undefined },
    });

    try {
      const ctx: Ctx = {
        universityId,
        campusIds: [], buildingIds: [], facultyIds: [], programIds: [], subjectIds: [],
        academicYearIds: [], sectionIds: [], classSessionIds: [], enrollmentIds: [],
        attendanceSessionIds: [], rubricIds: [], rubricSectionIds: [], schemeIds: [],
      };
      const tables: Record<string, any[]> = {};
      let rowCount = 0;
      for (const step of STEPS) {
        const rows = await step.fetch(this.prisma, ctx);
        tables[step.table] = rows;
        rowCount += rows.length;
        step.collect?.(rows, ctx);
      }

      const payload = { version: BACKUP_VERSION, universityId, exportedAt: new Date().toISOString(), tables };
      const json = JSON.stringify(payload);
      const gz = gzipSync(Buffer.from(json, 'utf8'));
      const checksum = createHash('sha256').update(gz).digest('hex');
      const fileName = `${backup.id}.json.gz`;
      writeFileSync(join(storageDir(), fileName), gz);

      return this.prisma.backup.update({
        where: { id: backup.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          fileName,
          storageKey: fileName,
          sizeBytes: gz.length,
          metadata: { note, rowCount, checksum, tables: Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length])) },
        },
      });
    } catch (err: any) {
      return this.prisma.backup.update({
        where: { id: backup.id },
        data: { status: 'FAILED', completedAt: new Date(), error: String(err?.message ?? err) },
      });
    }
  }

  async remove(universityId: string, id: string) {
    const backup = await this.prisma.backup.findFirst({ where: { id, universityId } });
    if (!backup) throw new NotFoundException('Backup not found');
    await this.prisma.backup.delete({ where: { id } });
    return { ok: true };
  }

  /** Keeps only the most recent `keep` completed automatic backups for a tenant, deleting the rest (row + file). */
  async pruneOldAutomatic(universityId: string, keep: number) {
    const old = await this.prisma.backup.findMany({
      where: { universityId, type: 'AUTOMATIC', status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      skip: keep,
      select: { id: true, storageKey: true },
    });
    for (const b of old) {
      if (b.storageKey) {
        const path = join(storageDir(), b.storageKey);
        if (existsSync(path)) unlinkSync(path);
      }
    }
    if (old.length > 0) await this.prisma.backup.deleteMany({ where: { id: { in: old.map((b) => b.id) } } });
    return { pruned: old.length };
  }

  /** Reads+decompresses the backup file for download; caller streams it as a response. */
  async fileFor(universityId: string, id: string): Promise<{ backup: any; gz: Buffer }> {
    const backup = await this.prisma.backup.findFirst({ where: { id, universityId } });
    if (!backup || backup.status !== 'COMPLETED' || !backup.storageKey) throw new NotFoundException('Backup not found or not completed');
    const gz = readFileSync(join(storageDir(), backup.storageKey));
    return { backup, gz };
  }

  /**
   * Restores rows from a backup file into the current tenant. Only inserts
   * rows that don't already exist (skipDuplicates) — restore never overwrites
   * live data. Student/Lecturer.userId is nulled out if the referenced User
   * no longer exists in this environment, since Users are outside backup scope.
   */
  async restore(universityId: string, id: string) {
    const { backup, gz } = await this.fileFor(universityId, id);
    if (backup.universityId !== universityId) throw new BadRequestException('Backup belongs to a different tenant');

    const json = gunzipSync(gz).toString('utf8');
    const payload = reviveDates(JSON.parse(json)) as { version: number; universityId: string; tables: Record<string, any[]> };
    if (payload.version !== BACKUP_VERSION) throw new BadRequestException(`Unsupported backup version ${payload.version}`);

    const existingUserIds = new Set((await this.prisma.user.findMany({ where: { universityId }, select: { id: true } })).map((u) => u.id));
    const sanitizeUserRef = (rows: any[]) => rows.map((r) => (r.userId && !existingUserIds.has(r.userId) ? { ...r, userId: null } : r));

    const summary: Record<string, number> = {};
    for (const step of STEPS) {
      let rows = payload.tables[step.table] ?? [];
      if (step.table === 'student' || step.table === 'lecturer') rows = sanitizeUserRef(rows);
      if (rows.length === 0) continue;
      const { count } = await step.restore(this.prisma, rows);
      summary[step.table] = count;
    }
    return { restored: summary, totalRows: Object.values(summary).reduce((a, b) => a + b, 0) };
  }
}
