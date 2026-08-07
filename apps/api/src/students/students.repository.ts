import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LookupStudentDto, QueryStudentDto } from './dto/query-student.dto';

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
    yearLevel: true,
    birthDate: true,
    createdAt: true,
    program: { select: { id: true, code: true, nameEn: true } },
  } satisfies Prisma.StudentSelect;

  /**
   * Identifying fields only. Used by the central-roster lookup, which a
   * lecturer may call for students they do not teach — so it must never
   * expose contact details, citizen/passport numbers, or date of birth.
   */
  private lookupSelection = {
    id: true,
    studentCode: true,
    nameEn: true,
    nameTh: true,
    yearLevel: true,
    status: true,
    program: { select: { id: true, code: true } },
  } satisfies Prisma.StudentSelect;

  private buildWhere(universityId: string, query: QueryStudentDto, sectionIds?: string[]): Prisma.StudentWhereInput {
    const where: Prisma.StudentWhereInput = { universityId, deletedAt: null };
    if (query.programId) where.programId = query.programId;
    if (query.status) where.status = query.status;
    if (query.yearLevel !== undefined) where.yearLevel = query.yearLevel;
    if (query.groupId) where.groups = { some: { groupId: query.groupId } };
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

  /** Central-roster search: identifying fields only, capped, never tenant-wide-unfiltered. */
  lookup(universityId: string, query: LookupStudentDto) {
    const where: Prisma.StudentWhereInput = {
      universityId, deletedAt: null,
      // Someone who has left the faculty should not turn up when building a class.
      status: { in: ['STUDYING', 'ON_LEAVE'] },
      ...(query.programId ? { programId: query.programId } : {}),
      // Year level narrows a cohort *browse*, but must never exclude someone
      // the caller searched for by code/name. A student whose year was never
      // recorded (yearLevel null — common for imported rosters), or who sits
      // in a different year, still exists: hiding them makes the picker
      // report "no matching student" for someone the roster page lists two
      // clicks away. When there's a search term the year becomes a display
      // hint only — the picker shows each hit's year so the caller can see
      // who they're adding.
      ...(query.yearLevel !== undefined && !query.q ? { yearLevel: query.yearLevel } : {}),
      ...(query.q
        ? { OR: [
            { studentCode: { contains: query.q, mode: 'insensitive' } },
            { nameEn: { contains: query.q, mode: 'insensitive' } },
            { nameTh: { contains: query.q, mode: 'insensitive' } },
            { nickname: { contains: query.q, mode: 'insensitive' } },
          ] }
        : {}),
      // Hide anyone already on the section's roster so the picker only offers
      // students that can actually be added.
      ...(query.excludeSectionId
        ? { enrollments: { none: { sectionId: query.excludeSectionId, status: 'ENROLLED' } } }
        : {}),
    };
    return this.prisma.student.findMany({
      where,
      select: this.lookupSelection,
      orderBy: { studentCode: 'asc' },
      take: query.take,
    });
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

  countBy(where: Prisma.StudentWhereInput) {
    return this.prisma.student.count({ where });
  }

  /**
   * Bulk year advance. `toYear === null` means this cohort is finishing the
   * curriculum, so they are marked graduated rather than pushed to a year
   * that does not exist.
   */
  promote(where: Prisma.StudentWhereInput, toYear: number | null, graduating: boolean) {
    return this.prisma.student.updateMany({
      where,
      data: graduating
        ? { status: 'GRADUATED', graduation: 'GRADUATED', graduatedAt: new Date(), yearLevel: null }
        : { yearLevel: toYear! },
    });
  }

  audit(entry: { universityId: string; userId: string; metadata: Prisma.InputJsonValue }) {
    return this.prisma.auditLog.create({
      data: {
        universityId: entry.universityId,
        userId: entry.userId,
        action: 'UPDATE',
        entityType: 'Student',
        metadata: entry.metadata,
      },
    });
  }

  softDelete(id: string) {
    return this.prisma.student.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }
}
