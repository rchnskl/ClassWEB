import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryStudentDto } from './dto/query-student.dto';

/**
 * Data-access layer for students. Every method is tenant-scoped by universityId
 * — the repository is the single place raw Prisma queries live (Repository
 * Pattern), so the service layer stays free of persistence concerns.
 */
@Injectable()
export class StudentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private selection = {
    id: true,
    studentCode: true,
    nameEn: true,
    nameTh: true,
    nickname: true,
    gender: true,
    email: true,
    phone: true,
    status: true,
    graduation: true,
    admissionYear: true,
    birthDate: true,
    createdAt: true,
    program: { select: { id: true, code: true, nameEn: true } },
  } satisfies Prisma.StudentSelect;

  private buildWhere(universityId: string, query: QueryStudentDto, sectionIds?: string[]): Prisma.StudentWhereInput {
    const where: Prisma.StudentWhereInput = { universityId, deletedAt: null };
    if (query.programId) where.programId = query.programId;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { nameEn: { contains: query.search, mode: 'insensitive' } },
        { nameTh: { contains: query.search, mode: 'insensitive' } },
        { studentCode: { contains: query.search, mode: 'insensitive' } },
        { nickname: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    // Non-admin callers pass their taught section ids here to restrict the
    // result to students actually enrolled in a section they teach.
    if (sectionIds) where.enrollments = { some: { sectionId: { in: sectionIds } } };
    return where;
  }

  async findMany(universityId: string, query: QueryStudentDto, sectionIds?: string[]) {
    const where = this.buildWhere(universityId, query, sectionIds);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.student.findMany({
        where,
        select: this.selection,
        orderBy: { createdAt: 'desc' },
        take: query.take,
        skip: query.skip,
      }),
      this.prisma.student.count({ where }),
    ]);
    return { items, total };
  }

  findById(universityId: string, id: string, sectionIds?: string[]) {
    return this.prisma.student.findFirst({
      where: {
        id, universityId, deletedAt: null,
        ...(sectionIds ? { enrollments: { some: { sectionId: { in: sectionIds } } } } : {}),
      },
      select: this.selection,
    });
  }

  programInTenant(universityId: string, programId: string) {
    return this.prisma.program.findFirst({
      where: { id: programId, deletedAt: null, faculty: { universityId } },
      select: { id: true },
    });
  }

  findByCode(universityId: string, studentCode: string) {
    return this.prisma.student.findFirst({
      where: { universityId, studentCode, deletedAt: null },
      select: { id: true },
    });
  }

  create(data: Prisma.StudentCreateInput) {
    return this.prisma.student.create({ data, select: this.selection });
  }

  update(id: string, data: Prisma.StudentUpdateInput) {
    return this.prisma.student.update({ where: { id }, data, select: this.selection });
  }

  softDelete(id: string) {
    return this.prisma.student.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }
}
