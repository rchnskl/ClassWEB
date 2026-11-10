import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DayOfWeek, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/authenticated-user';
import { AssessmentService } from '../assessment/assessment.service';
import { LecturerScopeService } from '../common/lecturer-scope.service';
import { CreateDatedSessionsDto, CreateScheduleDto, GenerateSessionsDto, UpdateSessionDto } from './dto/timetable.dto';

const JS_DAY_TO_ENUM: DayOfWeek[] = [
  DayOfWeek.SUNDAY, DayOfWeek.MONDAY, DayOfWeek.TUESDAY, DayOfWeek.WEDNESDAY,
  DayOfWeek.THURSDAY, DayOfWeek.FRIDAY, DayOfWeek.SATURDAY,
];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** True if [aStart,aEnd) overlaps [bStart,bEnd). */
function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(bStart) < toMinutes(aEnd);
}

@Injectable()
export class TimetableService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lecturerScope: LecturerScopeService,
    private readonly assessment: AssessmentService,
  ) {}

  private scheduleSelect = {
    id: true, dayOfWeek: true, startTime: true, endTime: true,
    section: {
      select: {
        id: true, sectionNo: true,
        subject: { select: { code: true, nameEn: true } },
      },
    },
    room: { select: { id: true, roomNumber: true } },
    lecturer: { select: { id: true, nameEn: true } },
  } satisfies Prisma.SectionScheduleSelect;

  async createSchedule(user: AuthenticatedUser, dto: CreateScheduleDto) {
    const universityId = user.universityId;
    if (toMinutes(dto.startTime) >= toMinutes(dto.endTime)) {
      throw new BadRequestException('startTime must be before endTime');
    }

    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, universityId, deletedAt: null },
      select: { id: true, semesterId: true, roomId: true, lecturerId: true },
    });
    if (!section) throw new BadRequestException('Section does not exist in this tenant');
    await this.lecturerScope.assertTeachesOrManages(user, section.id);

    const roomId = dto.roomId ?? section.roomId;
    const lecturerId = dto.lecturerId ?? section.lecturerId;

    await this.assertNoConflict(universityId, section.semesterId, {
      dayOfWeek: dto.dayOfWeek,
      startTime: dto.startTime,
      endTime: dto.endTime,
      roomId,
      lecturerId,
      sectionId: section.id,
    });

    return this.prisma.sectionSchedule.create({
      data: {
        section: { connect: { id: section.id } },
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        ...(roomId ? { room: { connect: { id: roomId } } } : {}),
        ...(lecturerId ? { lecturer: { connect: { id: lecturerId } } } : {}),
      },
      select: this.scheduleSelect,
    });
  }

  /** Room / teacher / section clash detection within the same semester + weekday. */
  private async assertNoConflict(
    universityId: string,
    semesterId: string,
    slot: { dayOfWeek: DayOfWeek; startTime: string; endTime: string; roomId: string | null; lecturerId: string | null; sectionId: string },
  ): Promise<void> {
    const candidates = await this.prisma.sectionSchedule.findMany({
      where: {
        dayOfWeek: slot.dayOfWeek,
        section: { semesterId, universityId, deletedAt: null },
        OR: [
          ...(slot.roomId ? [{ roomId: slot.roomId }] : []),
          ...(slot.lecturerId ? [{ lecturerId: slot.lecturerId }] : []),
          { sectionId: slot.sectionId },
        ],
      },
      select: { startTime: true, endTime: true, roomId: true, lecturerId: true, sectionId: true, room: { select: { roomNumber: true } } },
    });

    for (const c of candidates) {
      if (!overlaps(slot.startTime, slot.endTime, c.startTime, c.endTime)) continue;
      if (slot.roomId && c.roomId === slot.roomId) {
        throw new ConflictException(`Room conflict: ${c.room?.roomNumber ?? 'room'} is already booked ${c.startTime}–${c.endTime}`);
      }
      if (slot.lecturerId && c.lecturerId === slot.lecturerId) {
        throw new ConflictException(`Teacher conflict: lecturer already teaches ${c.startTime}–${c.endTime}`);
      }
      if (c.sectionId === slot.sectionId) {
        throw new ConflictException(`Section conflict: this section already meets ${c.startTime}–${c.endTime}`);
      }
    }
  }

  /**
   * Weekly schedule — a lecturer's own personal timetable shows only
   * sections they teach or manage; admin sees the whole faculty.
   */
  async timetable(user: AuthenticatedUser, semesterId?: string) {
    const universityId = user.universityId;
    const semester = semesterId
      ? await this.prisma.semester.findFirst({ where: { id: semesterId, academicYear: { universityId } }, select: { id: true } })
      : await this.prisma.semester.findFirst({ where: { isCurrent: true, academicYear: { universityId } }, select: { id: true } });
    if (!semester) return { semesterId: null, slots: [] };

    const sectionFilter = this.lecturerScope.isAdmin(user)
      ? {}
      : { id: { in: await this.lecturerScope.accessibleSectionIds(user) } };

    const slots = await this.prisma.sectionSchedule.findMany({
      where: { section: { semesterId: semester.id, universityId, deletedAt: null, ...sectionFilter } },
      select: this.scheduleSelect,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return { semesterId: semester.id, slots };
  }

  /** Expand a section's weekly schedule into concrete ClassSessions across the semester. */
  async generateSessions(user: AuthenticatedUser, dto: GenerateSessionsDto) {
    const universityId = user.universityId;
    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, universityId, deletedAt: null },
      select: {
        id: true,
        semester: { select: { startDate: true, endDate: true } },
        schedules: { select: { dayOfWeek: true, startTime: true, endTime: true, roomId: true, lecturerId: true } },
      },
    });
    if (!section) throw new BadRequestException('Section does not exist in this tenant');
    await this.lecturerScope.assertTeachesOrManages(user, section.id);
    if (section.schedules.length === 0) throw new BadRequestException('Section has no schedule to expand');

    const holidays = await this.prisma.calendarEvent.findMany({
      where: {
        universityId, type: 'HOLIDAY',
        startDate: { lte: section.semester.endDate },
        endDate: { gte: section.semester.startDate },
      },
      select: { startDate: true, endDate: true },
    });
    const isHoliday = (d: Date) => holidays.some((h) => d >= h.startDate && d <= h.endDate);

    const rows: Prisma.ClassSessionCreateManyInput[] = [];
    const start = new Date(section.semester.startDate);
    const end = new Date(section.semester.endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = JS_DAY_TO_ENUM[d.getUTCDay()];
      for (const s of section.schedules) {
        if (s.dayOfWeek !== dow) continue;
        rows.push({
          sectionId: section.id,
          roomId: s.roomId,
          lecturerId: s.lecturerId,
          sessionDate: new Date(d),
          startTime: s.startTime,
          endTime: s.endTime,
          status: isHoliday(d) ? 'HOLIDAY' : 'SCHEDULED',
        });
      }
    }

    // Idempotent: unique (sectionId, sessionDate, startTime) makes re-runs safe.
    const result = await this.prisma.classSession.createMany({ data: rows, skipDuplicates: true });
    return { sectionId: section.id, generated: result.count, totalPlanned: rows.length };
  }

  /**
   * Create class sessions on specific dates. Each date is checked against the
   * semester and against other sessions that day for the same room or
   * lecturer; re-sending a date that already has a session at that start time
   * is a no-op.
   */
  async createDatedSessions(user: AuthenticatedUser, dto: CreateDatedSessionsDto) {
    const universityId = user.universityId;
    if (toMinutes(dto.startTime) >= toMinutes(dto.endTime)) {
      throw new BadRequestException('startTime must be before endTime');
    }
    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, universityId, deletedAt: null },
      select: { id: true, roomId: true, lecturerId: true, semester: { select: { startDate: true, endDate: true } } },
    });
    if (!section) throw new BadRequestException('Section does not exist in this tenant');
    await this.lecturerScope.assertTeachesOrManages(user, section.id);

    const roomId = dto.roomId ?? section.roomId;
    const lecturerId = dto.lecturerId ?? section.lecturerId;
    if (roomId && !(await this.prisma.room.findFirst({ where: { id: roomId, building: { campus: { universityId } } }, select: { id: true } }))) {
      throw new BadRequestException('Room does not exist in this tenant');
    }
    if (lecturerId && !(await this.prisma.lecturer.findFirst({ where: { id: lecturerId, universityId }, select: { id: true } }))) {
      throw new BadRequestException('Lecturer does not exist in this tenant');
    }

    const dates = [...new Set(dto.dates)].sort().map((d) => new Date(`${d}T00:00:00.000Z`));
    for (const d of dates) {
      if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
      if (d < section.semester.startDate || d > section.semester.endDate) {
        throw new BadRequestException(`${d.toISOString().slice(0, 10)} is outside the section's semester`);
      }
    }

    // Same-day clashes with any other section's session in this room or with this lecturer.
    if (roomId || lecturerId) {
      const clashes = await this.prisma.classSession.findMany({
        where: {
          sessionDate: { in: dates },
          sectionId: { not: section.id },
          status: { not: 'CANCELLED' },
          section: { universityId, deletedAt: null },
          OR: [...(roomId ? [{ roomId }] : []), ...(lecturerId ? [{ lecturerId }] : [])],
        },
        select: { sessionDate: true, startTime: true, endTime: true, roomId: true, lecturerId: true },
      });
      for (const c of clashes) {
        if (!overlaps(dto.startTime, dto.endTime, c.startTime, c.endTime)) continue;
        const day = c.sessionDate.toISOString().slice(0, 10);
        if (roomId && c.roomId === roomId) throw new ConflictException(`Room conflict on ${day}: already booked ${c.startTime}–${c.endTime}`);
        throw new ConflictException(`Teacher conflict on ${day}: lecturer already teaches ${c.startTime}–${c.endTime}`);
      }
    }

    const result = await this.prisma.classSession.createMany({
      data: dates.map((d) => ({
        sectionId: section.id, sessionDate: d, startTime: dto.startTime, endTime: dto.endTime,
        roomId, lecturerId, topic: dto.topic ?? null, dailyAssessment: dto.dailyAssessment ?? true,
      })),
      skipDuplicates: true,
    });
    // More days to split daily components over.
    if (result.count > 0) await this.assessment.refreshDailyComponentsForSection(universityId, section.id);
    return { sectionId: section.id, created: result.count, requested: dates.length };
  }

  /**
   * Concrete class sessions — by section, by one day, or by a date range
   * (from/to, YYYY-MM-DD, inclusive). The timetable uses the range to show
   * dated sessions such as clinical ward days, which have no weekly slot.
   */
  async sessions(user: AuthenticatedUser, sectionId?: string, date?: string, from?: string, to?: string) {
    const universityId = user.universityId;
    if (sectionId) {
      await this.lecturerScope.assertTeachesOrManages(user, sectionId);
    }
    const where: Prisma.ClassSessionWhereInput = { section: { universityId, deletedAt: null } };
    if (sectionId) {
      where.sectionId = sectionId;
    } else if (!this.lecturerScope.isAdmin(user)) {
      where.sectionId = { in: await this.lecturerScope.accessibleSectionIds(user) };
    }
    if (date) {
      const day = new Date(date);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      where.sessionDate = { gte: day, lt: next };
    } else if (from || to) {
      const ymd = /^\d{4}-\d{2}-\d{2}$/;
      if ((from && !ymd.test(from)) || (to && !ymd.test(to))) throw new BadRequestException('from/to must be YYYY-MM-DD');
      where.sessionDate = {
        ...(from && { gte: new Date(`${from}T00:00:00Z`) }),
        ...(to && { lte: new Date(`${to}T00:00:00Z`) }),
      };
      where.status = { not: 'CANCELLED' };
    }
    const items = await this.prisma.classSession.findMany({
      where,
      select: {
        id: true, sessionDate: true, startTime: true, endTime: true, status: true, topic: true, dailyAssessment: true,
        section: { select: { id: true, sectionNo: true, subject: { select: { code: true, nameEn: true } } } },
        room: { select: { roomNumber: true } },
        lecturer: { select: { nameEn: true } },
      },
      orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
      take: 200,
    });
    return { total: items.length, items };
  }

  /**
   * Edit a session's topic, or whether it is offered as a day for daily
   * assessment. A day that already holds daily marks can't be taken out of
   * daily assessment — those marks feed the term score.
   */
  async updateSession(user: AuthenticatedUser, id: string, dto: UpdateSessionDto) {
    const session = await this.prisma.classSession.findFirst({
      where: { id, section: { universityId: user.universityId, deletedAt: null } },
      select: { id: true, sectionId: true },
    });
    if (!session) throw new NotFoundException('Session not found');
    await this.lecturerScope.assertTeachesOrManages(user, session.sectionId);
    if (dto.dailyAssessment === false) {
      const marked = await this.prisma.evaluation.count({ where: { classSessionId: id } });
      if (marked > 0) {
        throw new ConflictException(`This day already has ${marked} daily assessment(s); remove them before taking the day out of daily assessment`);
      }
    }
    const updated = await this.prisma.classSession.update({
      where: { id },
      data: {
        ...(dto.topic !== undefined && { topic: dto.topic }),
        ...(dto.dailyAssessment !== undefined && { dailyAssessment: dto.dailyAssessment }),
      },
      select: { id: true, sessionDate: true, startTime: true, endTime: true, topic: true, dailyAssessment: true },
    });
    // The number of days daily components are split over has changed.
    if (dto.dailyAssessment !== undefined) await this.assessment.refreshDailyComponentsForSection(user.universityId, session.sectionId);
    return updated;
  }
}
