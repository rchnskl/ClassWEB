import ExcelJS from 'exceljs';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AttendanceStatus, AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AssessmentService } from '../assessment/assessment.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ManualMarkDto, ResolveCheckInDto, SectionRuleDto } from './dto/attendance.dto';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';

interface RuleConfig {
  lateAfterMinutes: number;
  autoAbsentAfterMinutes: number;
  opensBeforeMinutes?: number | null;
}

const ruleSelect = { lateAfterMinutes: true, autoAbsentAfterMinutes: true, opensBeforeMinutes: true } as const;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly lecturerScope: LecturerScopeService,
    private readonly assessment: AssessmentService,
  ) {}

  // --- helpers -----------------------------------------------------------

  private pad(n: number): string {
    return String(n).padStart(2, '0');
  }

  /** Compose the session's start instant from its date (UTC calendar day) + HH:mm, campus-local (UTC+7). */
  private sessionStart(sessionDate: Date, startTime: string): Date {
    const y = sessionDate.getUTCFullYear();
    const m = this.pad(sessionDate.getUTCMonth() + 1);
    const d = this.pad(sessionDate.getUTCDate());
    return new Date(`${y}-${m}-${d}T${startTime}:00+07:00`);
  }

  /**
   * Auto-open window: on the session's own day (Bangkok time) check-in is
   * open and waiting from midnight, with no lecturer action needed, and it
   * stays open until the lecturer closes it — or the day ends. Lateness is
   * still judged against the scheduled start by the attendance rule.
   * Computed at request time; no scheduler needed.
   */
  private autoWindowBounds(sessionDate: Date, startTime?: string, opensBeforeMinutes?: number | null): { opensAt: Date; closesAt: Date } {
    const day = this.sessionStart(sessionDate, '00:00');
    // A section can open check-in a set time before class instead (a lecture
    // that opens at 14:00 for a 14:15 start).
    const opensAt = opensBeforeMinutes != null && startTime
      ? new Date(this.sessionStart(sessionDate, startTime).getTime() - opensBeforeMinutes * 60_000)
      : day;
    return { opensAt, closesAt: new Date(day.getTime() + 24 * 60 * 60_000) };
  }

  /**
   * Returns the currently-open AttendanceSession, auto-creating one if we're
   * inside the session's day and nothing is open. A window created this way
   * has `openedById: null`. Once the lecturer has closed check-in it stays
   * closed: the auto-window never reopens it (they can still reopen it).
   */
  private async ensureOpenWindow(classSessionId: string, sessionDate: Date, startTime: string, opensBeforeMinutes?: number | null) {
    const existing = await this.prisma.attendanceSession.findFirst({
      where: { classSessionId, isOpen: true, expiresAt: { gt: new Date() } },
    });
    if (existing) return existing;

    const now = new Date();
    const { opensAt, closesAt } = this.autoWindowBounds(sessionDate, startTime, opensBeforeMinutes);
    if (now < opensAt || now > closesAt) return null;
    const closedByLecturer = await this.prisma.attendanceSession.count({ where: { classSessionId, closedAt: { not: null } } });
    if (closedByLecturer > 0) return null;

    const token = randomBytes(12).toString('hex');
    return this.prisma.attendanceSession.create({
      data: { classSessionId, token, openedById: null, expiresAt: closesAt },
    });
  }

  private async rule(universityId: string, sectionId: string): Promise<RuleConfig> {
    const sectionRule = await this.prisma.attendanceRule.findFirst({
      where: { universityId, scope: 'SECTION', sectionId, isActive: true },
      select: ruleSelect,
    });
    if (sectionRule) return sectionRule;
    const uniRule = await this.prisma.attendanceRule.findFirst({
      where: { universityId, scope: 'UNIVERSITY', sectionId: null, isActive: true },
      select: ruleSelect,
    });
    return uniRule ?? { lateAfterMinutes: 15, autoAbsentAfterMinutes: 60 };
  }

  /** Rule engine: decide PRESENT / LATE / ABSENT from how late the check-in is. */
  private evaluate(rule: RuleConfig, start: Date, at: Date): { status: AttendanceStatus; minutesLate: number } {
    const minutesLate = Math.max(0, Math.floor((at.getTime() - start.getTime()) / 60000));
    if (minutesLate > rule.autoAbsentAfterMinutes) return { status: 'ABSENT', minutesLate };
    if (minutesLate > rule.lateAfterMinutes) return { status: 'LATE', minutesLate };
    return { status: 'PRESENT', minutesLate };
  }

  private async loadSession(universityId: string, classSessionId: string) {
    const session = await this.prisma.classSession.findFirst({
      where: { id: classSessionId, section: { universityId } },
      select: {
        id: true, sessionDate: true, startTime: true, endTime: true, status: true,
        section: { select: { id: true, universityId: true, sectionNo: true, subject: { select: { code: true, nameEn: true } } } },
      },
    });
    if (!session) throw new NotFoundException('Class session not found');
    return session;
  }

  // --- lecturer: open / close / state -----------------------------------

  async open(user: AuthenticatedUser, classSessionId: string) {
    const universityId = user.universityId;
    const userId = user.id;
    // Validates the session exists / belongs to this tenant (throws if not).
    const session = await this.loadSession(universityId, classSessionId);
    await this.lecturerScope.assertTeachesOrManages(user, session.section.id);
    // Reuse an existing open, unexpired window if present.
    const existing = await this.prisma.attendanceSession.findFirst({
      where: { classSessionId, isOpen: true, expiresAt: { gt: new Date() } },
    });
    if (existing) return { token: existing.token, expiresAt: existing.expiresAt, sessionId: existing.id };

    const token = randomBytes(12).toString('hex');
    // Open until the lecturer closes it: to the end of the session's day, or
    // 3 hours from now if that is later (reopening late in the evening).
    const expiresAt = new Date(Math.max(this.autoWindowBounds(session.sessionDate).closesAt.getTime(), Date.now() + 3 * 60 * 60 * 1000));
    const created = await this.prisma.attendanceSession.create({
      data: { classSessionId, token, openedById: userId, expiresAt },
    });
    await this.prisma.classSession.update({ where: { id: classSessionId }, data: { status: 'IN_PROGRESS' } });
    await this.prisma.auditLog.create({
      data: { universityId, userId, action: AuditAction.ATTENDANCE, entityType: 'AttendanceSession', entityId: created.id, metadata: { classSessionId, action: 'open' } },
    });
    return { token: created.token, expiresAt: created.expiresAt, sessionId: created.id };
  }

  async close(user: AuthenticatedUser, classSessionId: string) {
    const universityId = user.universityId;
    const session = await this.loadSession(universityId, classSessionId);
    await this.lecturerScope.assertTeachesOrManages(user, session.section.id);
    await this.prisma.attendanceSession.updateMany({
      where: { classSessionId, isOpen: true },
      data: { isOpen: false, closedAt: new Date() },
    });
    return { closed: true };
  }

  async state(user: AuthenticatedUser, classSessionId: string) {
    const universityId = user.universityId;
    const session = await this.loadSession(universityId, classSessionId);
    await this.lecturerScope.assertTeachesOrManages(user, session.section.id);
    const sectionRule = await this.rule(universityId, session.section.id);
    const openWindow = await this.ensureOpenWindow(classSessionId, session.sessionDate, session.startTime, sectionRule.opensBeforeMinutes);

    const enrollments = await this.prisma.enrollment.findMany({
      where: { sectionId: session.section.id, status: 'ENROLLED' },
      select: {
        id: true, studentId: true,
        student: { select: { studentCode: true, nameEn: true, nameTh: true } },
      },
      orderBy: { student: { studentCode: 'asc' } },
    });
    const records = await this.prisma.attendanceRecord.findMany({
      where: { classSessionId },
      select: { enrollmentId: true, status: true, method: true, checkInAt: true, minutesLate: true },
    });
    const byEnrollment = new Map(records.map((r) => [r.enrollmentId, r]));

    const roster = enrollments.map((e) => ({
      enrollmentId: e.id,
      studentId: e.studentId,
      studentCode: e.student.studentCode,
      nameEn: e.student.nameEn,
      nameTh: e.student.nameTh,
      record: byEnrollment.get(e.id) ?? null,
    }));

    const pending = await this.prisma.attendanceCheckIn.findMany({
      where: { classSessionId, status: 'PENDING' },
      select: { id: true, enteredCode: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      classSession: {
        id: session.id, date: session.sessionDate, startTime: session.startTime, endTime: session.endTime,
        status: session.status, sectionNo: session.section.sectionNo, subject: session.section.subject,
      },
      open: openWindow ?? null,
      counts: {
        enrolled: roster.length,
        present: roster.filter((r) => r.record?.status === 'PRESENT').length,
        late: roster.filter((r) => r.record?.status === 'LATE').length,
        absent: roster.filter((r) => r.record?.status === 'ABSENT').length,
        pending: pending.length,
      },
      roster,
      pending,
    };
  }

  // --- lecturer: manual mark --------------------------------------------

  async manualMark(user: AuthenticatedUser, dto: ManualMarkDto) {
    const universityId = user.universityId;
    const userId = user.id;
    const session = await this.loadSession(universityId, dto.classSessionId);
    await this.lecturerScope.assertTeachesOrManages(user, session.section.id);
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { sectionId: session.section.id, studentId: dto.studentId, status: 'ENROLLED' },
      select: { id: true },
    });
    if (!enrollment) throw new BadRequestException('Student is not enrolled in this section');

    const record = await this.prisma.attendanceRecord.upsert({
      where: { classSessionId_enrollmentId: { classSessionId: dto.classSessionId, enrollmentId: enrollment.id } },
      create: {
        classSession: { connect: { id: dto.classSessionId } },
        enrollment: { connect: { id: enrollment.id } },
        student: { connect: { id: dto.studentId } },
        status: dto.status, method: 'MANUAL', recordedById: userId,
        checkInAt: dto.status === 'ABSENT' ? null : new Date(),
      },
      update: { status: dto.status, method: 'MANUAL', recordedById: userId },
      select: { id: true, status: true, method: true },
    });
    await this.recomputeRate(enrollment.id);
    if (dto.status === 'ABSENT') await this.notifyAbsent(universityId, dto.studentId, session.section.subject.code);
    await this.prisma.auditLog.create({
      data: { universityId, userId, action: AuditAction.ATTENDANCE, entityType: 'AttendanceRecord', entityId: record.id, metadata: { classSessionId: dto.classSessionId, status: dto.status, method: 'MANUAL' } },
    });
    return record;
  }

  // --- student: QR self check-in (public, token-authorised) -------------

  async checkInContext(token: string) {
    const window = await this.prisma.attendanceSession.findFirst({
      where: { token, isOpen: true, expiresAt: { gt: new Date() } },
      select: {
        expiresAt: true,
        classSession: { select: { sessionDate: true, startTime: true, endTime: true, section: { select: { sectionNo: true, subject: { select: { code: true, nameEn: true } } } } } },
      },
    });
    if (!window) throw new NotFoundException('Attendance is closed or the code has expired');
    return {
      subject: window.classSession.section.subject,
      sectionNo: window.classSession.section.sectionNo,
      date: window.classSession.sessionDate,
      startTime: window.classSession.startTime,
      endTime: window.classSession.endTime,
    };
  }

  async checkIn(token: string, studentCode: string, ip?: string | null, confirm = false) {
    const window = await this.prisma.attendanceSession.findFirst({
      where: { token, isOpen: true, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        classSession: {
          select: {
            id: true, sessionDate: true, startTime: true,
            section: { select: { id: true, universityId: true, subject: { select: { code: true } } } },
          },
        },
      },
    });
    if (!window) throw new NotFoundException('Attendance is closed or the code has expired');

    const cs = window.classSession;
    const code = studentCode.trim();

    // Already checked in successfully? Idempotent.
    const prior = await this.prisma.attendanceCheckIn.findFirst({
      where: { attendanceSessionId: window.id, enteredCode: code, status: 'MATCHED' },
      select: { attendanceStatus: true },
    });
    if (prior) return { result: 'success', attendanceStatus: prior.attendanceStatus, alreadyDone: true };

    // Match against the section's active enrolment.
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { sectionId: cs.section.id, status: 'ENROLLED', student: { studentCode: code, universityId: cs.section.universityId, deletedAt: null } },
      select: { id: true, studentId: true },
    });

    if (!enrollment) {
      // Ask the student to double-check a possible typo before committing anything.
      // Only a confirmed unmatched code becomes a PENDING item for the lecturer.
      if (!confirm) {
        return { result: 'unmatched_confirm', enteredCode: code };
      }
      await this.prisma.attendanceCheckIn.create({
        data: { attendanceSessionId: window.id, classSessionId: cs.id, enteredCode: code, status: 'PENDING', ipAddress: ip ?? null },
      });
      return { result: 'pending', message: 'contact_instructor' };
    }

    const ruleConfig = await this.rule(cs.section.universityId, cs.section.id);
    const { status, minutesLate } = this.evaluate(ruleConfig, this.sessionStart(cs.sessionDate, cs.startTime), new Date());

    await this.prisma.$transaction([
      this.prisma.attendanceRecord.upsert({
        where: { classSessionId_enrollmentId: { classSessionId: cs.id, enrollmentId: enrollment.id } },
        create: {
          classSession: { connect: { id: cs.id } },
          enrollment: { connect: { id: enrollment.id } },
          student: { connect: { id: enrollment.studentId } },
          status, method: 'QR_CODE', checkInAt: new Date(), minutesLate,
        },
        update: { status, method: 'QR_CODE', checkInAt: new Date(), minutesLate },
      }),
      this.prisma.attendanceCheckIn.create({
        data: {
          attendanceSessionId: window.id, classSessionId: cs.id, enteredCode: code,
          status: 'MATCHED', matchedStudentId: enrollment.studentId, matchedEnrollmentId: enrollment.id,
          attendanceStatus: status, minutesLate, ipAddress: ip ?? null,
        },
      }),
    ]);
    await this.recomputeRate(enrollment.id);
    if (status === 'ABSENT') await this.notifyAbsent(cs.section.universityId, enrollment.studentId, cs.section.subject.code);
    return { result: 'success', attendanceStatus: status, minutesLate };
  }

  // --- lecturer: resolve a pending check-in -----------------------------

  async resolve(user: AuthenticatedUser, checkInId: string, dto: ResolveCheckInDto) {
    const universityId = user.universityId;
    const userId = user.id;
    // Verify the check-in belongs to the caller's tenant via its session → section.
    const ci = await this.prisma.attendanceCheckIn.findFirst({
      where: {
        id: checkInId,
        attendanceSession: { classSession: { section: { universityId } } },
      },
      select: { id: true, attendanceSession: { select: { classSession: { select: { section: { select: { id: true } } } } } } },
    });
    if (!ci) throw new NotFoundException('Check-in not found');
    await this.lecturerScope.assertTeachesOrManages(user, ci.attendanceSession.classSession.section.id);

    const updated = await this.prisma.attendanceCheckIn.update({
      where: { id: checkInId },
      data: {
        status: dto.action === 'ACCEPT' ? 'MATCHED' : 'REJECTED',
        attendanceStatus: dto.action === 'ACCEPT' ? (dto.status ?? 'PRESENT') : null,
        reason: dto.reason,
        reasonNote: dto.reasonNote,
        resolvedById: userId,
        resolvedAt: new Date(),
      },
      select: { id: true, status: true, reason: true, attendanceStatus: true },
    });
    await this.prisma.auditLog.create({
      data: { universityId, userId, action: AuditAction.ATTENDANCE, entityType: 'AttendanceCheckIn', entityId: checkInId, metadata: { action: dto.action, reason: dto.reason } },
    });
    return updated;
  }

  // --- analytics ---------------------------------------------------------

  /** Recompute an enrolment's attendance percentage; notify when it crosses below 80%. */
  private async recomputeRate(enrollmentId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { id: enrollmentId },
      select: {
        attendanceRate: true, studentId: true,
        student: { select: { nameEn: true, nameTh: true } },
        section: { select: { id: true, universityId: true, subject: { select: { code: true } } } },
      },
    });
    if (!enrollment) return;
    const previous = enrollment.attendanceRate;
    // Absent / on-leave days don't count toward daily components, so a
    // change of attendance can change how many days the score is split over.
    await this.assessment.refreshDailyComponentsForSection(enrollment.section.universityId, enrollment.section.id, enrollment.studentId);

    const [total, attended] = await this.prisma.$transaction([
      this.prisma.attendanceRecord.count({ where: { enrollmentId } }),
      this.prisma.attendanceRecord.count({ where: { enrollmentId, status: { in: ['PRESENT', 'LATE'] } } }),
    ]);
    const rate = total > 0 ? Math.round((attended / total) * 1000) / 10 : null;
    await this.prisma.enrollment.update({ where: { id: enrollmentId }, data: { attendanceRate: rate } });

    // Fire a risk notification only on the transition into < 80% (avoids spam).
    if (rate !== null && rate < 80 && (previous === null || previous >= 80)) {
      const name = enrollment.student.nameTh ?? enrollment.student.nameEn;
      void this.notifications.notify({
        universityId: enrollment.section.universityId,
        type: 'BELOW_80',
        title: `นักศึกษาเข้าเรียนต่ำกว่า 80%`,
        body: `${name} (${enrollment.section.subject.code}) เข้าเรียน ${rate}%`,
        refType: 'Student', refId: enrollment.studentId,
      }).catch(() => undefined);
    }
  }

  /** Best-effort "student absent" notification. */
  private async notifyAbsent(universityId: string, studentId: string, subjectCode: string) {
    const student = await this.prisma.student.findUnique({ where: { id: studentId }, select: { nameEn: true, nameTh: true } });
    const name = student?.nameTh ?? student?.nameEn ?? 'นักศึกษา';
    void this.notifications.notify({
      universityId, type: 'STUDENT_ABSENT',
      title: 'นักศึกษาขาดเรียน',
      body: `${name} ขาดเรียนวิชา ${subjectCode}`,
      refType: 'Student', refId: studentId,
    }).catch(() => undefined);
  }

  // --- per-section attendance rule ------------------------------------

  /** The rule that applies to a section: its own, else the university-wide one. */
  async sectionRule(user: AuthenticatedUser, sectionId: string) {
    const section = await this.prisma.section.findFirst({ where: { id: sectionId, universityId: user.universityId, deletedAt: null }, select: { id: true } });
    if (!section) throw new NotFoundException('Section not found');
    await this.lecturerScope.assertTeachesOrManages(user, sectionId);
    const own = await this.prisma.attendanceRule.findFirst({
      where: { universityId: user.universityId, scope: 'SECTION', sectionId, isActive: true }, select: ruleSelect,
    });
    return { sectionId, own: !!own, ...(own ?? (await this.rule(user.universityId, sectionId))) };
  }

  /**
   * Set a section's own rule: when check-in opens (minutes before the start,
   * or null for all day), and after how many minutes past the start a
   * check-in is late / counted absent.
   */
  async setSectionRule(user: AuthenticatedUser, sectionId: string, dto: SectionRuleDto) {
    await this.sectionRule(user, sectionId); // existence + scope
    if (dto.autoAbsentAfterMinutes < dto.lateAfterMinutes) {
      throw new BadRequestException('autoAbsentAfterMinutes must be at least lateAfterMinutes');
    }
    const data = {
      lateAfterMinutes: dto.lateAfterMinutes,
      autoAbsentAfterMinutes: dto.autoAbsentAfterMinutes,
      opensBeforeMinutes: dto.opensBeforeMinutes ?? null,
    };
    const existing = await this.prisma.attendanceRule.findFirst({ where: { universityId: user.universityId, scope: 'SECTION', sectionId }, select: { id: true } });
    if (existing) await this.prisma.attendanceRule.update({ where: { id: existing.id }, data: { ...data, isActive: true } });
    else await this.prisma.attendanceRule.create({ data: { universityId: user.universityId, scope: 'SECTION', sectionId, name: 'Section attendance policy', ...data } });
    await this.prisma.auditLog.create({
      data: { universityId: user.universityId, userId: user.id, action: AuditAction.UPDATE, entityType: 'AttendanceRule', entityId: sectionId, metadata: data },
    });
    return this.sectionRule(user, sectionId);
  }

  // --- daily overview report -------------------------------------------

  /**
   * Attendance overview of a section, day by day: for every class day, how
   * many were present / late / absent / on leave / not recorded and the
   * attendance rate; and a student-by-day grid with each student's rate.
   * The rate counts present + late over the recorded days.
   */
  async sectionDaily(user: AuthenticatedUser, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, universityId: user.universityId, deletedAt: null },
      select: {
        id: true, sectionNo: true,
        subject: { select: { code: true, nameEn: true, nameTh: true } },
        semester: { select: { nameEn: true, nameTh: true } },
        lecturer: { select: { nameEn: true, nameTh: true } },
        room: { select: { roomNumber: true } },
      },
    });
    if (!section) throw new NotFoundException('Section not found');
    await this.lecturerScope.assertTeachesOrManages(user, sectionId);

    const [sessions, enrollments] = await Promise.all([
      this.prisma.classSession.findMany({
        where: { sectionId, status: { not: 'CANCELLED' } },
        select: { id: true, sessionDate: true, startTime: true, endTime: true, topic: true },
        orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.enrollment.findMany({
        where: { sectionId, status: 'ENROLLED' },
        select: { id: true, student: { select: { id: true, studentCode: true, nameEn: true, nameTh: true } } },
        orderBy: { student: { studentCode: 'asc' } },
      }),
    ]);
    const records = await this.prisma.attendanceRecord.findMany({
      where: { classSessionId: { in: sessions.map((x) => x.id) }, enrollmentId: { in: enrollments.map((e) => e.id) } },
      select: { classSessionId: true, enrollmentId: true, status: true, minutesLate: true, method: true, recordedById: true, checkInAt: true, updatedAt: true },
    });
    const key = (cs: string, en: string) => `${cs}|${en}`;
    const byKey = new Map(records.map((r) => [key(r.classSessionId, r.enrollmentId), r]));

    // Who recorded each mark: a lecturer/admin login for a manual mark, or
    // the student themself for a QR check-in (which needs no login).
    const recorderIds = [...new Set(records.map((r) => r.recordedById).filter((x): x is string => !!x))];
    const recorderUsers = recorderIds.length === 0 ? [] : await this.prisma.user.findMany({
      where: { id: { in: recorderIds }, universityId: user.universityId },
      select: { id: true, email: true, lecturer: { select: { nameEn: true, nameTh: true } } },
    });
    const recorders = new Map(recorderUsers.map((u) => [u.id, { userId: u.id, email: u.email, nameEn: u.lecturer?.nameEn ?? null, nameTh: u.lecturer?.nameTh ?? null }]));
    type Recorder = { kind: 'SELF' | 'USER' | 'UNKNOWN'; userId: string | null; email: string | null; nameEn: string | null; nameTh: string | null };
    const recorderOf = (r: { method: string; recordedById: string | null }): Recorder => {
      if (r.recordedById) {
        const u = recorders.get(r.recordedById);
        return { kind: 'USER', userId: r.recordedById, email: u?.email ?? null, nameEn: u?.nameEn ?? null, nameTh: u?.nameTh ?? null };
      }
      if (r.method !== 'MANUAL') return { kind: 'SELF', userId: null, email: null, nameEn: null, nameTh: null };
      return { kind: 'UNKNOWN', userId: null, email: null, nameEn: null, nameTh: null };
    };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

    const days = sessions.map((s) => {
      const c = { present: 0, late: 0, absent: 0, leave: 0, unrecorded: 0 };
      for (const e of enrollments) {
        const r = byKey.get(key(s.id, e.id));
        if (!r) c.unrecorded++;
        else if (r.status === 'PRESENT') c.present++;
        else if (r.status === 'LATE') c.late++;
        else if (r.status === 'ABSENT') c.absent++;
        else c.leave++;
      }
      const recorded = enrollments.length - c.unrecorded;
      const date = s.sessionDate.toISOString().slice(0, 10);
      // Tally of who recorded this day's marks, most first.
      const tally = new Map<string, Recorder & { count: number }>();
      for (const e of enrollments) {
        const r = byKey.get(key(s.id, e.id));
        if (!r) continue;
        const who = recorderOf(r);
        const k = who.kind === 'USER' ? `U:${who.userId}` : who.kind;
        const cur = tally.get(k);
        if (cur) cur.count++; else tally.set(k, { ...who, count: 1 });
      }
      return {
        sessionId: s.id, date, startTime: s.startTime, endTime: s.endTime, topic: s.topic,
        upcoming: date > today, enrolled: enrollments.length, ...c,
        rate: pct(c.present + c.late, recorded),
        recordedBy: [...tally.values()].sort((a, b) => b.count - a.count),
      };
    });

    const students = enrollments.map((e) => {
      const marks = sessions.map((s) => {
        const r = byKey.get(key(s.id, e.id));
        return r ? r.status : null;
      });
      const marksBy = sessions.map((s) => {
        const r = byKey.get(key(s.id, e.id));
        if (!r) return null;
        return { ...recorderOf(r), method: r.method, at: (r.method === 'MANUAL' ? r.updatedAt : r.checkInAt ?? r.updatedAt).toISOString(), minutesLate: r.minutesLate };
      });
      const recorded = marks.filter((m) => m != null).length;
      const attended = marks.filter((m) => m === 'PRESENT' || m === 'LATE').length;
      return {
        studentId: e.student.id, studentCode: e.student.studentCode, nameEn: e.student.nameEn, nameTh: e.student.nameTh,
        marks, marksBy, attended, absent: marks.filter((m) => m === 'ABSENT').length, late: marks.filter((m) => m === 'LATE').length,
        rate: pct(attended, recorded),
      };
    });

    const held = days.filter((d) => d.enrolled - d.unrecorded > 0);
    const totals = {
      classDays: days.length,
      daysHeld: held.length,
      averageRate: pct(held.reduce((a, d) => a + d.present + d.late, 0), held.reduce((a, d) => a + d.enrolled - d.unrecorded, 0)),
      studentsBelow80: students.filter((s) => s.rate != null && s.rate < 80).length,
    };
    return { section, days, students, totals };
  }

  /** The same overview as an Excel workbook: a day summary sheet and a student × day grid. */
  async sectionDailyXlsx(user: AuthenticatedUser, sectionId: string): Promise<{ buffer: Buffer; filename: string }> {
    const d = await this.sectionDaily(user, sectionId);
    const wb = new ExcelJS.Workbook();
    const head = (row: ExcelJS.Row) => {
      row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E7C7B' } }; });
    };
    const title = `${d.section.subject.code} ${d.section.subject.nameEn} · Sec ${d.section.sectionNo}`;
    const daysWs = wb.addWorksheet('Daily summary');
    daysWs.addRow([title]); daysWs.getRow(1).font = { bold: true, size: 13 };
    daysWs.addRow([`Average attendance: ${d.totals.averageRate ?? '-'}% over ${d.totals.daysHeld} of ${d.totals.classDays} class days · ${d.totals.studentsBelow80} student(s) below 80%`]);
    daysWs.addRow([]);
    const who = (r: { kind: string; email: string | null; nameEn: string | null; nameTh?: string | null }) =>
      r.kind === 'SELF' ? 'Student self check-in (QR)'
        : r.kind === 'UNKNOWN' ? 'Unknown'
          : [r.nameTh ?? r.nameEn, r.email].filter(Boolean).join(' · ') || 'Unknown user';
    head(daysWs.addRow(['Date', 'Time', 'Topic', 'Enrolled', 'Present', 'Late', 'Absent', 'Leave/Excused', 'Not recorded', 'Attendance %', 'Recorded by']));
    for (const x of d.days) {
      daysWs.addRow([x.date, `${x.startTime}-${x.endTime}`, x.topic ?? '', x.enrolled, x.present, x.late, x.absent, x.leave, x.upcoming ? 'upcoming' : x.unrecorded, x.rate ?? '',
        x.recordedBy.map((r) => `${who(r)} (${r.count})`).join('; ')]);
    }
    [12, 12, 28, 10, 10, 8, 8, 14, 13, 13, 50].forEach((w, i) => { daysWs.getColumn(i + 1).width = w; });

    const grid = wb.addWorksheet('Students x days');
    const sym: Record<string, string> = { PRESENT: '/', LATE: 'L', ABSENT: 'A', LEAVE: 'Le', EXCUSED: 'E' };
    head(grid.addRow(['No.', 'Student ID', 'Name', ...d.days.map((x) => x.date.slice(5)), 'Attended', 'Late', 'Absent', 'Attendance %']));
    d.students.forEach((s, i) => {
      const row = grid.addRow([i + 1, s.studentCode, s.nameTh ? `${s.nameTh} (${s.nameEn})` : s.nameEn, ...s.marks.map((m) => (m ? sym[m] ?? m : '')), s.attended, s.late, s.absent, s.rate ?? '']);
      if (s.rate != null && s.rate < 80) row.getCell(3 + d.days.length + 4).font = { bold: true, color: { argb: 'FFC0392B' } };
    });
    grid.addRow([]);
    grid.addRow(['', '', '/ = present · L = late · A = absent · Le = leave · E = excused']);
    grid.getColumn(1).width = 5; grid.getColumn(2).width = 11; grid.getColumn(3).width = 36;
    for (let i = 0; i < d.days.length; i++) grid.getColumn(4 + i).width = 7;
    grid.views = [{ state: 'frozen', xSplit: 3, ySplit: 1 }];

    // Every recorded mark with who recorded it and when.
    const log = wb.addWorksheet('Recorded by');
    head(log.addRow(['Date', 'Student ID', 'Name', 'Status', 'Method', 'Recorded by', 'Login email', 'Recorded at']));
    const at = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(iso));
    d.days.forEach((x, di) => {
      for (const s of d.students) {
        const m = s.marksBy[di];
        if (!m) continue;
        log.addRow([x.date, s.studentCode, s.nameTh ?? s.nameEn, s.marks[di], m.method === 'MANUAL' ? 'Manual' : m.method === 'QR_CODE' ? 'QR code' : m.method,
          m.kind === 'SELF' ? 'Student (self check-in)' : m.kind === 'UNKNOWN' ? 'Unknown' : (m.nameTh ?? m.nameEn ?? ''), m.email ?? '', at(m.at)]);
      }
    });
    [12, 11, 30, 10, 10, 30, 30, 18].forEach((w, i) => { log.getColumn(i + 1).width = w; });
    log.views = [{ state: 'frozen', ySplit: 1 }];
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `attendance-${d.section.subject.code}-sec${d.section.sectionNo}.xlsx` };
  }
}
