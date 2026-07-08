import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEnrollmentDto, QueryEnrollmentDto } from './dto/enrollment.dto';
import { Paginated } from '../common/dto/pagination.dto';

@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true, status: true, enrollDate: true, dropDate: true, dropReason: true, attendanceRate: true,
    student: { select: { id: true, studentCode: true, nameEn: true } },
    section: { select: { id: true, sectionNo: true, subject: { select: { code: true, nameEn: true } } } },
  } satisfies Prisma.EnrollmentSelect;

  async list(universityId: string, query: QueryEnrollmentDto): Promise<Paginated<unknown>> {
    const where: Prisma.EnrollmentWhereInput = {
      section: { universityId },
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.enrollment.findMany({ where, select: this.select, orderBy: { enrollDate: 'desc' }, take: query.take, skip: query.skip }),
      this.prisma.enrollment.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  /** Enrol a student into a section: capacity + duplicate checks, atomic counter update. */
  async create(universityId: string, dto: CreateEnrollmentDto) {
    const section = await this.prisma.section.findFirst({
      where: { id: dto.sectionId, universityId, deletedAt: null },
      select: { id: true, capacity: true },
    });
    if (!section) throw new BadRequestException('Section does not exist in this tenant');

    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, universityId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new BadRequestException('Student does not exist in this tenant');

    const existing = await this.prisma.enrollment.findUnique({
      where: { sectionId_studentId: { sectionId: dto.sectionId, studentId: dto.studentId } },
      select: { id: true, status: true },
    });
    if (existing && existing.status === 'ENROLLED') {
      throw new ConflictException('Student is already enrolled in this section');
    }

    return this.prisma.$transaction(async (tx) => {
      const active = await tx.enrollment.count({ where: { sectionId: dto.sectionId, status: 'ENROLLED' } });
      if (active >= section.capacity) {
        throw new ConflictException('Section is at full capacity');
      }
      const enrollment = existing
        ? await tx.enrollment.update({
            where: { id: existing.id },
            data: { status: 'ENROLLED', enrollDate: new Date(), dropDate: null, dropReason: null },
            select: this.select,
          })
        : await tx.enrollment.create({
            data: { section: { connect: { id: dto.sectionId } }, student: { connect: { id: dto.studentId } } },
            select: this.select,
          });
      await tx.section.update({
        where: { id: dto.sectionId },
        data: { currentEnrollment: active + 1 },
      });
      return enrollment;
    });
  }

  async drop(universityId: string, id: string, reason?: string) {
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { id, section: { universityId } },
      select: { id: true, status: true, sectionId: true },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found');
    if (enrollment.status !== 'ENROLLED') throw new BadRequestException('Enrollment is not active');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.enrollment.update({
        where: { id },
        data: { status: 'DROPPED', dropDate: new Date(), dropReason: reason },
        select: this.select,
      });
      const active = await tx.enrollment.count({ where: { sectionId: enrollment.sectionId, status: 'ENROLLED' } });
      await tx.section.update({ where: { id: enrollment.sectionId }, data: { currentEnrollment: active } });
      return updated;
    });
  }
}
