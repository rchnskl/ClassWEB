import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCalendarEntryDto, QueryCalendarDto } from './dto/calendar.dto';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true, type: true, visibility: true, title: true, description: true,
    startAt: true, endAt: true, allDay: true, location: true, color: true,
    createdById: true,
    room: { select: { id: true, roomNumber: true } },
    lecturer: { select: { id: true, nameEn: true } },
  } satisfies Prisma.CalendarEntrySelect;

  /**
   * Entries overlapping [from, to). A PRIVATE entry (personal appointments —
   * the whole point of `visibility: PRIVATE` in the schema) is visible only
   * to the user who created it; FACULTY/PUBLIC entries are visible to
   * everyone in the tenant as before. This was previously unscoped — every
   * user's private calendar entries were readable by any other user in the
   * tenant via this endpoint.
   */
  async list(universityId: string, userId: string, query: QueryCalendarDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    const items = await this.prisma.calendarEntry.findMany({
      where: {
        universityId,
        deletedAt: null,
        startAt: { lt: to },
        endAt: { gt: from },
        ...(query.type ? { type: query.type } : {}),
        OR: [
          { visibility: { not: 'PRIVATE' } },
          { visibility: 'PRIVATE', createdById: userId },
        ],
      },
      select: this.select,
      orderBy: { startAt: 'asc' },
      take: 500,
    });
    return { total: items.length, items };
  }

  async create(universityId: string, userId: string, dto: CreateCalendarEntryDto) {
    const start = new Date(dto.startAt);
    const end = new Date(dto.endAt);
    if (end <= start) throw new BadRequestException('endAt must be after startAt');

    if (dto.roomId) {
      const room = await this.prisma.room.findFirst({
        where: { id: dto.roomId, deletedAt: null, building: { campus: { universityId } } }, select: { id: true },
      });
      if (!room) throw new BadRequestException('Room does not exist in this tenant');
    }
    if (dto.lecturerId) {
      const lecturer = await this.prisma.lecturer.findFirst({
        where: { id: dto.lecturerId, universityId, deletedAt: null }, select: { id: true },
      });
      if (!lecturer) throw new BadRequestException('Lecturer does not exist in this tenant');
    }

    return this.prisma.calendarEntry.create({
      data: {
        university: { connect: { id: universityId } },
        type: dto.type,
        visibility: dto.visibility ?? (dto.type === 'PERSONAL' ? 'PRIVATE' : 'FACULTY'),
        title: dto.title,
        description: dto.description,
        startAt: start,
        endAt: end,
        allDay: dto.allDay ?? false,
        location: dto.location,
        color: dto.color,
        createdById: userId,
        ...(dto.roomId ? { room: { connect: { id: dto.roomId } } } : {}),
        ...(dto.lecturerId ? { lecturer: { connect: { id: dto.lecturerId } } } : {}),
      },
      select: this.select,
    });
  }

  async remove(universityId: string, userId: string, isAdmin: boolean, id: string) {
    const entry = await this.prisma.calendarEntry.findFirst({
      where: { id, universityId, deletedAt: null }, select: { id: true, createdById: true, visibility: true },
    });
    if (!entry) throw new NotFoundException('Calendar entry not found');
    if (!isAdmin && entry.visibility === 'PRIVATE' && entry.createdById !== userId) {
      throw new ForbiddenException('You can only delete your own personal entries');
    }
    await this.prisma.calendarEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id, deleted: true };
  }
}
