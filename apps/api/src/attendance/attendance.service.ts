import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AttendanceStatus, AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ManualMarkDto, ResolveCheckInDto } from './dto/attendance.dto';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';

interface RuleConfig {
  lateAfterMinutes: number;
  autoAbsentAfterMinutes: number;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly lecturerScope: LecturerScopeService,
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
   * Auto-open/close window: capture is available from 30 minutes before the
   * session's scheduled start through 45 minutes after it, with no lecturer
   * action required. The lecturer's manual open()/close() still overrides
   * this at any time — this only fills the gap when nobody has touched the
   * toggle. Computed at request time; no cron/scheduler needed since the
   * window is derived straight from ClassSession.sessionDate/startTime.
   */
  private autoWindowBounds(start: Date): { opensAt: Date; closesAt: Date } {
    return {
      opensAt: new Date(start.getTime() - 30 * 60_000),
      closesAt: new Date(start.getTime() + 45 * 60_000),
    };
  }

  /**
   * Returns the currently-open AttendanceSession, auto-creating one if we're
   * inside the auto-window and no manual window is already open. A window
   * created this way has `openedById: null` so it's distinguishable from an
   * explicit lecturer open() (which gets a generous fixed 3h expiry instead
   * of the 45-minute auto-close).
   */
  private async ensureOpenWindow(classSessionId: string, sessionDate: Date, startTime: string) {
    const existing = await this.prisma.attendanceSession.findFirst({
      where: { classSessionId, isOpen: true, expiresAt: { gt: new Date() } },
    });
    if (existing) return existing;

    const start = this.sessionStart(sessionDate, startTime);
    const now = new Date();
    const { opensAt, closesAt } = this.autoWindowBounds(start);
    if (now < opensAt || now > closesAt) return null;

    const token = randomBytes(12).toString('hex');
    return this.prisma.attendanceSession.create({
      data: { classSessionId, token, openedById: null, expiresAt: closesAt },
    });
  }

  private async rule(universityId: string, sectionId: string): Promise<RuleConfig> {
    const sectionRule = await this.prisma.attendanceRule.findFirst({
      where: { universityId, scope: 'SECTION', sectionId, isActive: true },
      select: { lateAfterMinutes: true, autoAbsentAfterMinutes: true },
    });
    if (sectionRule) return sectionRule;
    const uniRule = await this.prisma.attendanceRule.findFirst({
      where: { universityId, scope: 'UNIVERSITY', sectionId: null, isActive: true },
      select: { lateAfterMinutes: true, autoAbsentAfterMinutes: true },
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
    const expiresAt = new Date(Date.now() + 3 * 60 * 60 * 1000); // 3h window
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
    const openWindow = await this.ensureOpenWindow(classSessionId, session.sessionDate, session.startTime);

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
        section: { select: { universityId: true, subject: { select: { code: true } } } },
      },
    });
    if (!enrollment) return;
    const previous = enrollment.attendanceRate;

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
}
