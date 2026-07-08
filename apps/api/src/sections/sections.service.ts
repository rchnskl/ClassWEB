import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSectionDto, QuerySectionDto } from './dto/section.dto';
import { Paginated } from '../common/dto/pagination.dto';

@Injectable()
export class SectionsService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true, sectionNo: true, capacity: true, currentEnrollment: true, isActive: true,
    subject: { select: { id: true, code: true, nameEn: true, credits: true } },
    semester: { select: { id: true, nameEn: true, academicYear: { select: { code: true } } } },
    lecturer: { select: { id: true, nameEn: true, employeeCode: true } },
    room: { select: { id: true, roomNumber: true } },
    _count: { select: { enrollments: true } },
  } satisfies Prisma.SectionSelect;

  async list(universityId: string, query: QuerySectionDto): Promise<Paginated<unknown>> {
    const where: Prisma.SectionWhereInput = {
      universityId, deletedAt: null,
      ...(query.semesterId ? { semesterId: query.semesterId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.lecturerId ? { lecturerId: query.lecturerId } : {}),
      ...(query.search
        ? { subject: { OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { nameEn: { contains: query.search, mode: 'insensitive' } },
          ] } }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.section.findMany({ where, select: this.select, orderBy: [{ subject: { code: 'asc' } }, { sectionNo: 'asc' }], take: query.take, skip: query.skip }),
      this.prisma.section.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  async get(universityId: string, id: string) {
    const section = await this.prisma.section.findFirst({
      where: { id, universityId, deletedAt: null },
      select: this.select,
    });
    if (!section) throw new NotFoundException('Section not found');
    return section;
  }

  async create(universityId: string, dto: CreateSectionDto) {
    const subject = await this.prisma.subject.findFirst({
      where: { id: dto.subjectId, deletedAt: null, program: { faculty: { universityId } } },
      select: { id: true },
    });
    if (!subject) throw new BadRequestException('Subject does not exist in this tenant');

    const semester = await this.prisma.semester.findFirst({
      where: { id: dto.semesterId, deletedAt: null, academicYear: { universityId } },
      select: { id: true },
    });
    if (!semester) throw new BadRequestException('Semester does not exist in this tenant');

    if (dto.lecturerId) {
      const lecturer = await this.prisma.lecturer.findFirst({
        where: { id: dto.lecturerId, universityId, deletedAt: null }, select: { id: true },
      });
      if (!lecturer) throw new BadRequestException('Lecturer does not exist in this tenant');
    }
    if (dto.roomId) {
      const room = await this.prisma.room.findFirst({
        where: { id: dto.roomId, deletedAt: null, building: { campus: { universityId } } }, select: { id: true },
      });
      if (!room) throw new BadRequestException('Room does not exist in this tenant');
    }

    const clash = await this.prisma.section.findFirst({
      where: { subjectId: dto.subjectId, semesterId: dto.semesterId, sectionNo: dto.sectionNo, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw new ConflictException('A section with this number already exists for the subject/semester');

    return this.prisma.section.create({
      data: {
        university: { connect: { id: universityId } },
        subject: { connect: { id: dto.subjectId } },
        semester: { connect: { id: dto.semesterId } },
        sectionNo: dto.sectionNo,
        capacity: dto.capacity ?? 40,
        ...(dto.lecturerId ? { lecturer: { connect: { id: dto.lecturerId } } } : {}),
        ...(dto.roomId ? { room: { connect: { id: dto.roomId } } } : {}),
      },
      select: this.select,
    });
  }
}
