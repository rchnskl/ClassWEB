import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DayOfWeek, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto, GenerateSessionsDto } from './dto/timetable.dto';

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
  constructor(private readonly prisma: PrismaService) {}

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

  async createSchedule(universityId: string, dto: CreateScheduleDto) {
    if (toMinutes(dto.startTime) >= toMinutes(dto.endTime)) {
      throw new BadRequestException('startTime must be before endTime');
    }

    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, universityId, deletedAt: null },
      select: { id: true, semesterId: true, roomId: true, lecturerId: true },
    });
    if (!section) throw new BadRequestException('Section does not exist in this tenant');

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

  async timetable(universityId: string, semesterId?: string) {
    const semester = semesterId
      ? await this.prisma.semester.findFirst({ where: { id: semesterId, academicYear: { universityId } }, select: { id: true } })
      : await this.prisma.semester.findFirst({ where: { isCurrent: true, academicYear: { universityId } }, select: { id: true } });
    if (!semester) return { semesterId: null, slots: [] };

    const slots = await this.prisma.sectionSchedule.findMany({
      where: { section: { semesterId: semester.id, universityId, deletedAt: null } },
      select: this.scheduleSelect,
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    return { semesterId: semester.id, slots };
  }

  /** Expand a section's weekly schedule into concrete ClassSessions across the semester. */
  async generateSessions(universityId: string, dto: GenerateSessionsDto) {
    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, universityId, deletedAt: null },
      select: {
        id: true,
        semester: { select: { startDate: true, endDate: true } },
        schedules: { select: { dayOfWeek: true, startTime: true, endTime: true, roomId: true, lecturerId: true } },
      },
    });
    if (!section) throw new BadRequestException('Section does not exist in this tenant');
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

  async sessions(universityId: string, sectionId?: string, date?: string) {
    const where: Prisma.ClassSessionWhereInput = { section: { universityId, deletedAt: null } };
    if (sectionId) where.sectionId = sectionId;
    if (date) {
      const day = new Date(date);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      where.sessionDate = { gte: day, lt: next };
    }
    const items = await this.prisma.classSession.findMany({
      where,
      select: {
        id: true, sessionDate: true, startTime: true, endTime: true, status: true,
        section: { select: { sectionNo: true, subject: { select: { code: true, nameEn: true } } } },
        room: { select: { roomNumber: true } },
        lecturer: { select: { nameEn: true } },
      },
      orderBy: [{ sessionDate: 'asc' }, { startTime: 'asc' }],
      take: 200,
    });
    return { total: items.length, items };
  }
}
