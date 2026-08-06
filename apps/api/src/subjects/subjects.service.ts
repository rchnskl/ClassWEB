import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubjectDto, QuerySubjectDto, UpdateSubjectDto } from './dto/subject.dto';
import { Paginated } from '../common/dto/pagination.dto';

@Injectable()
export class SubjectsService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true, code: true, nameEn: true, nameTh: true, credits: true, description: true, category: true, yearLevel: true,
    program: { select: { id: true, code: true, nameEn: true } },
    course: { select: { id: true, code: true, nameEn: true } },
    _count: { select: { sections: true } },
  } satisfies Prisma.SubjectSelect;

  async list(universityId: string, query: QuerySubjectDto): Promise<Paginated<unknown>> {
    const where: Prisma.SubjectWhereInput = {
      deletedAt: null,
      program: { faculty: { universityId } },
      ...(query.programId ? { programId: query.programId } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.yearLevel !== undefined ? { yearLevel: query.yearLevel } : {}),
      ...(query.search
        ? { OR: [
            { code: { contains: query.search, mode: 'insensitive' } },
            { nameEn: { contains: query.search, mode: 'insensitive' } },
          ] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.subject.findMany({ where, select: this.select, orderBy: { code: 'asc' }, take: query.take, skip: query.skip }),
      this.prisma.subject.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  async get(universityId: string, id: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id, deletedAt: null, program: { faculty: { universityId } } },
      select: this.select,
    });
    if (!subject) throw new NotFoundException('Subject not found');
    return subject;
  }

  async create(universityId: string, dto: CreateSubjectDto) {
    const program = await this.prisma.program.findFirst({
      where: { id: dto.programId, faculty: { universityId } },
      select: { id: true },
    });
    if (!program) throw new BadRequestException('Program does not exist in this tenant');

    const course = await this.prisma.course.findFirst({
      where: { id: dto.courseId, programId: dto.programId },
      select: { id: true },
    });
    if (!course) throw new BadRequestException('Course does not belong to the given program');

    const clash = await this.prisma.subject.findFirst({
      where: { programId: dto.programId, code: dto.code, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`Subject code ${dto.code} already exists in this program`);

    return this.prisma.subject.create({
      data: {
        program: { connect: { id: dto.programId } },
        course: { connect: { id: dto.courseId } },
        code: dto.code,
        nameEn: dto.nameEn,
        nameTh: dto.nameTh,
        description: dto.description,
        credits: dto.credits ?? 3,
        category: dto.category,
        yearLevel: dto.yearLevel,
      },
      select: this.select,
    });
  }

  async update(universityId: string, id: string, dto: UpdateSubjectDto) {
    const subject = await this.prisma.subject.findFirst({
      where: { id, deletedAt: null, program: { faculty: { universityId } } },
    });
    if (!subject) throw new NotFoundException('Subject not found');

    if (dto.programId) {
      const program = await this.prisma.program.findFirst({ where: { id: dto.programId, faculty: { universityId } }, select: { id: true } });
      if (!program) throw new BadRequestException('Program does not exist in this tenant');
    }
    if (dto.courseId) {
      const course = await this.prisma.course.findFirst({ where: { id: dto.courseId, programId: dto.programId ?? subject.programId }, select: { id: true } });
      if (!course) throw new BadRequestException('Course does not belong to the given program');
    }
    if (dto.code) {
      const clash = await this.prisma.subject.findFirst({
        where: { programId: dto.programId ?? subject.programId, code: dto.code, deletedAt: null, NOT: { id } },
      });
      if (clash) throw new ConflictException(`Subject code ${dto.code} already exists in this program`);
    }

    return this.prisma.subject.update({
      where: { id },
      data: {
        ...(dto.programId !== undefined && { program: { connect: { id: dto.programId } } }),
        ...(dto.courseId !== undefined && { course: { connect: { id: dto.courseId } } }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.credits !== undefined && { credits: dto.credits }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.yearLevel !== undefined && { yearLevel: dto.yearLevel }),
      },
      select: this.select,
    });
  }

  async remove(universityId: string, id: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id, deletedAt: null, program: { faculty: { universityId } } },
      select: { id: true, _count: { select: { sections: true } } },
    });
    if (!subject) throw new NotFoundException('Subject not found');
    if (subject._count.sections > 0) {
      throw new ConflictException(`This subject has ${subject._count.sections} section(s) and cannot be deleted`);
    }
    await this.prisma.subject.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }
}
