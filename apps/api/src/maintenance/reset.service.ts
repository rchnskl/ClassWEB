import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** What the admin must type to start a reset — long enough not to be hit by accident. */
export const RESET_CONFIRMATION = 'ARCHIVE AND RESET';

type Tx = Prisma.TransactionClient;

/**
 * One table the reset clears. Steps run in this order inside one transaction,
 * so every child is gone before its parent (most relations are ON DELETE
 * RESTRICT on purpose — nothing disappears as a side effect).
 */
interface Step {
  key: string;
  count: (db: Tx, u: string) => Promise<number>;
  clear: (db: Tx, u: string) => Promise<{ count: number }>;
}

// Tenant scoping for tables without their own universityId column.
const section = (u: string) => ({ section: { universityId: u } });
const classSession = (u: string) => ({ classSession: section(u) });
const program = (u: string) => ({ faculty: { universityId: u } });
const subject = (u: string) => ({ program: program(u) });

/**
 * Start-of-new-scheme reset: clears every piece of teaching and assessment
 * data for one university and keeps what describes the institution and who
 * can sign in.
 *
 * KEPT: users, roles & permissions, sign-in sessions, settings & branding,
 * university / campuses / faculties / departments, lecturers, buildings &
 * rooms, the university-wide attendance rule, attachments, backups, the audit
 * log, and the assessment *definitions* — rubrics and grade schemes — so they
 * can be adapted to the new scheme instead of rebuilt (their links to
 * subjects go with the subjects).
 *
 * CLEARED: students & groups, academic years & semesters, programs, courses,
 * subjects, sections and their timetable, class sessions, enrollments,
 * attendance (records, QR sessions, check-ins), section-level attendance
 * rules, evaluations & scores, reports, student notes,
 * notifications, and calendar events/entries.
 *
 * The data is archived OUTSIDE this tool, before it runs (a Neon branch and a
 * downloaded backup file); this only clears.
 */
const STEPS: Step[] = [
  { key: 'attendanceCheckIns',
    count: (db, u) => db.attendanceCheckIn.count({ where: { attendanceSession: classSession(u) } }),
    clear: (db, u) => db.attendanceCheckIn.deleteMany({ where: { attendanceSession: classSession(u) } }) },
  { key: 'attendanceSessions',
    count: (db, u) => db.attendanceSession.count({ where: classSession(u) }),
    clear: (db, u) => db.attendanceSession.deleteMany({ where: classSession(u) }) },
  { key: 'attendanceRecords',
    count: (db, u) => db.attendanceRecord.count({ where: classSession(u) }),
    clear: (db, u) => db.attendanceRecord.deleteMany({ where: classSession(u) }) },
  // Evaluation scores and rubric sections/items go with their parents (ON DELETE CASCADE).
  { key: 'evaluations',
    count: (db, u) => db.evaluation.count({ where: { universityId: u } }),
    clear: (db, u) => db.evaluation.deleteMany({ where: { universityId: u } }) },
  { key: 'studentNotes',
    count: (db, u) => db.studentNote.count({ where: { universityId: u } }),
    clear: (db, u) => db.studentNote.deleteMany({ where: { universityId: u } }) },
  // Group members go with their group (ON DELETE CASCADE).
  { key: 'studentGroups',
    count: (db, u) => db.studentGroup.count({ where: { universityId: u } }),
    clear: (db, u) => db.studentGroup.deleteMany({ where: { universityId: u } }) },
  { key: 'enrollments',
    count: (db, u) => db.enrollment.count({ where: section(u) }),
    clear: (db, u) => db.enrollment.deleteMany({ where: section(u) }) },
  { key: 'classSessions',
    count: (db, u) => db.classSession.count({ where: section(u) }),
    clear: (db, u) => db.classSession.deleteMany({ where: section(u) }) },
  { key: 'sectionSchedules',
    count: (db, u) => db.sectionSchedule.count({ where: section(u) }),
    clear: (db, u) => db.sectionSchedule.deleteMany({ where: section(u) }) },
  { key: 'sectionLecturers',
    count: (db, u) => db.sectionLecturer.count({ where: section(u) }),
    clear: (db, u) => db.sectionLecturer.deleteMany({ where: section(u) }) },
  // The university-wide rule (sectionId = null) is a setting and stays.
  { key: 'sectionAttendanceRules',
    count: (db, u) => db.attendanceRule.count({ where: { universityId: u, sectionId: { not: null } } }),
    clear: (db, u) => db.attendanceRule.deleteMany({ where: { universityId: u, sectionId: { not: null } } }) },
  { key: 'sections',
    count: (db, u) => db.section.count({ where: { universityId: u } }),
    clear: (db, u) => db.section.deleteMany({ where: { universityId: u } }) },
  { key: 'subjectMemberships',
    count: (db, u) => db.subjectMembership.count({ where: { subject: subject(u) } }),
    clear: (db, u) => db.subjectMembership.deleteMany({ where: { subject: subject(u) } }) },
  { key: 'subjects',
    count: (db, u) => db.subject.count({ where: subject(u) }),
    clear: (db, u) => db.subject.deleteMany({ where: subject(u) }) },
  { key: 'courses',
    count: (db, u) => db.course.count({ where: { program: program(u) } }),
    clear: (db, u) => db.course.deleteMany({ where: { program: program(u) } }) },
  { key: 'students',
    count: (db, u) => db.student.count({ where: { universityId: u } }),
    clear: (db, u) => db.student.deleteMany({ where: { universityId: u } }) },
  { key: 'programs',
    count: (db, u) => db.program.count({ where: program(u) }),
    clear: (db, u) => db.program.deleteMany({ where: program(u) }) },
  { key: 'calendarEvents',
    count: (db, u) => db.calendarEvent.count({ where: { universityId: u } }),
    clear: (db, u) => db.calendarEvent.deleteMany({ where: { universityId: u } }) },
  { key: 'semesters',
    count: (db, u) => db.semester.count({ where: { academicYear: { universityId: u } } }),
    clear: (db, u) => db.semester.deleteMany({ where: { academicYear: { universityId: u } } }) },
  { key: 'academicYears',
    count: (db, u) => db.academicYear.count({ where: { universityId: u } }),
    clear: (db, u) => db.academicYear.deleteMany({ where: { universityId: u } }) },
  { key: 'calendarEntries',
    count: (db, u) => db.calendarEntry.count({ where: { universityId: u } }),
    clear: (db, u) => db.calendarEntry.deleteMany({ where: { universityId: u } }) },
  { key: 'reports',
    count: (db, u) => db.report.count({ where: { universityId: u } }),
    clear: (db, u) => db.report.deleteMany({ where: { universityId: u } }) },
  { key: 'notifications',
    count: (db, u) => db.notification.count({ where: { universityId: u } }),
    clear: (db, u) => db.notification.deleteMany({ where: { universityId: u } }) },
];

export type ResetCounts = Record<string, number>;

@Injectable()
export class ResetService {
  constructor(private readonly prisma: PrismaService) {}

  /** How many rows each step would clear — changes nothing. */
  async preview(universityId: string): Promise<{ counts: ResetCounts; total: number; confirmation: string }> {
    const counts: ResetCounts = {};
    for (const step of STEPS) counts[step.key] = await step.count(this.prisma, universityId);
    return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), confirmation: RESET_CONFIRMATION };
  }

  /**
   * Clears everything listed above in one transaction: either all of it goes
   * or none of it does. Requires the exact confirmation phrase and the admin's
   * statement that the data has been archived first.
   */
  async reset(universityId: string, actorId: string, confirmation: string, archived: boolean) {
    if (confirmation !== RESET_CONFIRMATION) {
      throw new BadRequestException(`Type "${RESET_CONFIRMATION}" exactly to confirm.`);
    }
    if (!archived) {
      throw new BadRequestException('Archive the data first (database branch and downloaded backup), then confirm that you have.');
    }

    const cleared: ResetCounts = {};
    await this.prisma.$transaction(
      async (tx) => {
        for (const step of STEPS) cleared[step.key] = (await step.clear(tx, universityId)).count;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    const total = Object.values(cleared).reduce((a, b) => a + b, 0);
    await this.prisma.auditLog.create({
      data: {
        universityId,
        userId: actorId,
        action: AuditAction.DELETE,
        entityType: 'Maintenance',
        metadata: { action: 'archiveAndReset', total, cleared },
      },
    });
    return { cleared, total, ranAt: new Date() };
  }
}
