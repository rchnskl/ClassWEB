import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, StudentGroupScope } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnrollmentsService } from '../enrollments/enrollments.service';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';
import { Paginated } from '../common/dto/pagination.dto';
import {
  AddGroupMembersDto, AutoSplitDto, CreateStudentGroupDto, EnrollGroupDto,
  QueryStudentGroupDto, SplitStrategy, UpdateStudentGroupDto,
} from './dto/student-group.dto';

/**
 * Student groups: named cohorts lecturers assign work to as a unit.
 *
 * Authorisation note — the RBAC permission matrix is generated from a fixed
 * resource list in the seed, so groups deliberately reuse `enrollment:*`
 * (they are the same domain: organising students into class units) rather
 * than requiring an RBAC data migration on a live tenant. On top of that
 * permission check, scope ownership is enforced here:
 *   CENTRAL — faculty-wide shared cohorts, ADMIN only. One lecturer must not
 *             be able to reshape a cohort that every other lecturer uses.
 *   SECTION — ad-hoc sub-groups, editable by the section's own lecturer.
 * Reading, and enrolling *from* a group, is open to any lecturer.
 */
@Injectable()
export class StudentGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lecturerScope: LecturerScopeService,
    private readonly enrollments: EnrollmentsService,
  ) {}

  private select = {
    id: true, scope: true, code: true, nameEn: true, nameTh: true, order: true, isActive: true,
    yearLevel: true, createdAt: true,
    program: { select: { id: true, code: true, nameEn: true } },
    section: { select: { id: true, sectionNo: true, subject: { select: { code: true, nameEn: true } } } },
    _count: { select: { members: true } },
  } satisfies Prisma.StudentGroupSelect;

  private memberSelect = {
    id: true, studentCode: true, nameEn: true, nameTh: true, yearLevel: true, status: true,
    program: { select: { id: true, code: true } },
  } satisfies Prisma.StudentSelect;

  // ---- authorisation -----------------------------------------------------

  /** Throws unless the caller may create/modify a group with this scope. */
  private async assertCanManage(
    user: AuthenticatedUser,
    scope: StudentGroupScope,
    sectionId?: string | null,
  ) {
    if (this.lecturerScope.isAdmin(user)) return;
    if (scope === 'CENTRAL') {
      throw new ForbiddenException('Only an administrator can manage central (faculty-wide) groups');
    }
    if (!sectionId) throw new BadRequestException('A section-scoped group requires a sectionId');
    await this.lecturerScope.assertTeaches(user, sectionId);
  }

  // ---- reads -------------------------------------------------------------

  async list(user: AuthenticatedUser, query: QueryStudentGroupDto): Promise<Paginated<unknown>> {
    const where: Prisma.StudentGroupWhereInput = {
      universityId: user.universityId, deletedAt: null,
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.programId ? { programId: query.programId } : {}),
      ...(query.yearLevel !== undefined ? { yearLevel: query.yearLevel } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.search
        ? { OR: [
            { nameEn: { contains: query.search, mode: 'insensitive' } },
            { nameTh: { contains: query.search, mode: 'insensitive' } },
            { code: { contains: query.search, mode: 'insensitive' } },
          ] }
        : {}),
    };
    // A lecturer sees every central group (they are shared by design) but only
    // the section-scoped groups belonging to sections they teach.
    if (!this.lecturerScope.isAdmin(user)) {
      const me = await this.lecturerScope.myLecturerId(user);
      const mine = me ? await this.lecturerScope.sectionIdsFor(me) : [];
      where.OR = [
        { scope: 'CENTRAL' },
        { scope: 'SECTION', sectionId: { in: mine } },
      ];
      if (query.search) {
        // Keep the text filter as a separate AND clause so it can't be
        // swallowed by the scope OR above.
        where.AND = [{ OR: [
          { nameEn: { contains: query.search, mode: 'insensitive' } },
          { nameTh: { contains: query.search, mode: 'insensitive' } },
          { code: { contains: query.search, mode: 'insensitive' } },
        ] }];
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.studentGroup.findMany({
        where, select: this.select,
        orderBy: [{ yearLevel: 'asc' }, { order: 'asc' }, { nameEn: 'asc' }],
        take: query.take, skip: query.skip,
      }),
      this.prisma.studentGroup.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  async get(user: AuthenticatedUser, id: string) {
    const group = await this.prisma.studentGroup.findFirst({
      where: { id, universityId: user.universityId, deletedAt: null },
      select: {
        ...this.select,
        members: {
          select: { student: { select: this.memberSelect } },
          orderBy: { student: { studentCode: 'asc' } },
        },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    if (!this.lecturerScope.isAdmin(user) && group.scope === 'SECTION' && group.section) {
      await this.lecturerScope.assertTeaches(user, group.section.id);
    }
    const { members, ...rest } = group;
    return { ...rest, members: members.map((m) => m.student) };
  }

  // ---- writes ------------------------------------------------------------

  async create(user: AuthenticatedUser, dto: CreateStudentGroupDto) {
    const scope = dto.scope ?? 'CENTRAL';
    await this.assertCanManage(user, scope, dto.sectionId);
    await this.assertScopeRefs(user, scope, dto.programId, dto.sectionId);

    return this.prisma.studentGroup.create({
      data: {
        university: { connect: { id: user.universityId } },
        scope,
        nameEn: dto.nameEn,
        nameTh: dto.nameTh,
        code: dto.code,
        order: dto.order ?? 0,
        ...(scope === 'CENTRAL'
          ? {
              ...(dto.programId ? { program: { connect: { id: dto.programId } } } : {}),
              yearLevel: dto.yearLevel ?? null,
            }
          : { section: { connect: { id: dto.sectionId! } } }),
      },
      select: this.select,
    });
  }

  /** Validates that referenced program/section actually belong to this tenant. */
  private async assertScopeRefs(
    user: AuthenticatedUser, scope: StudentGroupScope, programId?: string, sectionId?: string,
  ) {
    if (scope === 'SECTION') {
      if (!sectionId) throw new BadRequestException('A section-scoped group requires a sectionId');
      const section = await this.prisma.section.findFirst({
        where: { id: sectionId, universityId: user.universityId, deletedAt: null }, select: { id: true },
      });
      if (!section) throw new BadRequestException('Section does not exist in this tenant');
      return;
    }
    if (programId) {
      const program = await this.prisma.program.findFirst({
        where: { id: programId, deletedAt: null, faculty: { universityId: user.universityId } }, select: { id: true },
      });
      if (!program) throw new BadRequestException('Program does not exist in this tenant');
    }
  }

  private async loadForWrite(user: AuthenticatedUser, id: string) {
    const group = await this.prisma.studentGroup.findFirst({
      where: { id, universityId: user.universityId, deletedAt: null },
      select: { id: true, scope: true, sectionId: true, programId: true, yearLevel: true },
    });
    if (!group) throw new NotFoundException('Group not found');
    await this.assertCanManage(user, group.scope, group.sectionId);
    return group;
  }

  async update(user: AuthenticatedUser, id: string, dto: UpdateStudentGroupDto) {
    await this.loadForWrite(user, id);
    return this.prisma.studentGroup.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.order !== undefined && { order: dto.order }),
        ...(dto.yearLevel !== undefined && { yearLevel: dto.yearLevel }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      select: this.select,
    });
  }

  async remove(user: AuthenticatedUser, id: string) {
    await this.loadForWrite(user, id);
    // Membership rows are worthless without the group and carry no academic
    // record of their own (grades/attendance hang off Enrollment), so they go
    // with it rather than blocking the delete.
    await this.prisma.$transaction([
      this.prisma.studentGroupMember.deleteMany({ where: { groupId: id } }),
      this.prisma.studentGroup.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    ]);
    return { id, deleted: true };
  }

  // ---- membership --------------------------------------------------------

  async addMembers(user: AuthenticatedUser, id: string, dto: AddGroupMembersDto) {
    await this.loadForWrite(user, id);
    const ids = [...new Set(dto.studentIds)];
    const valid = await this.prisma.student.findMany({
      where: { id: { in: ids }, universityId: user.universityId, deletedAt: null },
      select: { id: true },
    });
    const validIds = new Set(valid.map((s) => s.id));
    const rejected = ids.filter((sid) => !validIds.has(sid));

    const result = await this.prisma.studentGroupMember.createMany({
      data: valid.map((s) => ({ groupId: id, studentId: s.id })),
      skipDuplicates: true,
    });
    return { added: result.count, alreadyMembers: valid.length - result.count, rejected };
  }

  async removeMember(user: AuthenticatedUser, id: string, studentId: string) {
    await this.loadForWrite(user, id);
    const { count } = await this.prisma.studentGroupMember.deleteMany({ where: { groupId: id, studentId } });
    if (count === 0) throw new NotFoundException('Student is not a member of this group');
    return { groupId: id, studentId, removed: true };
  }

  // ---- auto-split --------------------------------------------------------

  /**
   * Creates `groupCount` groups and distributes a cohort (or a section's
   * roster) across them. Sizes differ by at most one student, so a 58-student
   * cohort split 6 ways gives 10/10/10/10/9/9 rather than 5 full groups and a
   * remainder of 3.
   */
  async autoSplit(user: AuthenticatedUser, dto: AutoSplitDto) {
    const scope = dto.scope ?? 'CENTRAL';
    await this.assertCanManage(user, scope, dto.sectionId);
    await this.assertScopeRefs(user, scope, dto.programId, dto.sectionId);

    const students = scope === 'SECTION'
      ? (await this.prisma.enrollment.findMany({
          where: { sectionId: dto.sectionId!, status: 'ENROLLED' },
          select: { student: { select: { id: true, studentCode: true } } },
          orderBy: { student: { studentCode: 'asc' } },
        })).map((e) => e.student)
      : await this.prisma.student.findMany({
          where: {
            universityId: user.universityId, deletedAt: null, status: 'STUDYING',
            ...(dto.programId ? { programId: dto.programId } : {}),
            ...(dto.yearLevel !== undefined ? { yearLevel: dto.yearLevel } : {}),
          },
          select: { id: true, studentCode: true },
          orderBy: { studentCode: 'asc' },
        });

    if (students.length === 0) throw new BadRequestException('No students match this cohort — nothing to split');
    if (dto.groupCount > students.length) {
      throw new BadRequestException(`Cannot split ${students.length} student(s) into ${dto.groupCount} groups`);
    }

    const buckets = this.distribute(students.map((s) => s.id), dto.groupCount, dto.strategy ?? SplitStrategy.SEQUENTIAL);
    const prefixEn = dto.namePrefixEn ?? 'Group';
    const prefixTh = dto.namePrefixTh ?? 'กลุ่ม';

    const created = await this.prisma.$transaction(async (tx) => {
      const out = [];
      for (const [i, bucket] of buckets.entries()) {
        const group = await tx.studentGroup.create({
          data: {
            university: { connect: { id: user.universityId } },
            scope,
            nameEn: `${prefixEn} ${i + 1}`,
            nameTh: `${prefixTh} ${i + 1}`,
            code: `G${i + 1}`,
            order: i,
            ...(scope === 'CENTRAL'
              ? {
                  ...(dto.programId ? { program: { connect: { id: dto.programId } } } : {}),
                  yearLevel: dto.yearLevel ?? null,
                }
              : { section: { connect: { id: dto.sectionId! } } }),
          },
          select: this.select,
        });
        await tx.studentGroupMember.createMany({
          data: bucket.map((studentId) => ({ groupId: group.id, studentId })),
          skipDuplicates: true,
        });
        out.push({ ...group, _count: { members: bucket.length } });
      }
      return out;
    });

    await this.prisma.auditLog.create({
      data: {
        universityId: user.universityId, userId: user.id, action: AuditAction.CREATE,
        entityType: 'StudentGroup',
        metadata: { action: 'autoSplit', scope, groupCount: dto.groupCount, students: students.length, strategy: dto.strategy ?? SplitStrategy.SEQUENTIAL },
      },
    });
    return { groups: created, totalStudents: students.length };
  }

  /** Splits ids into `count` buckets whose sizes differ by at most one. */
  private distribute(ids: string[], count: number, strategy: SplitStrategy): string[][] {
    const buckets: string[][] = Array.from({ length: count }, () => []);
    if (strategy === SplitStrategy.ROUND_ROBIN) {
      ids.forEach((id, i) => buckets[i % count].push(id));
      return buckets;
    }
    const base = Math.floor(ids.length / count);
    const remainder = ids.length % count;
    let cursor = 0;
    for (let i = 0; i < count; i++) {
      // The first `remainder` groups take one extra so no group is short by more than one.
      const size = base + (i < remainder ? 1 : 0);
      buckets[i] = ids.slice(cursor, cursor + size);
      cursor += size;
    }
    return buckets;
  }

  // ---- bulk enrolment ----------------------------------------------------

  /**
   * Enrols every member of a group into a section. Delegates each student to
   * EnrollmentsService so capacity, duplicate, same-subject and student-status
   * rules stay in exactly one place. Partial success is intentional: one
   * already-enrolled student must not block the other thirty.
   */
  async enrollIntoSection(user: AuthenticatedUser, id: string, dto: EnrollGroupDto) {
    const group = await this.prisma.studentGroup.findFirst({
      where: { id, universityId: user.universityId, deletedAt: null },
      select: {
        id: true, nameEn: true,
        members: {
          select: { student: { select: { id: true, studentCode: true, nameEn: true } } },
          orderBy: { student: { studentCode: 'asc' } },
        },
      },
    });
    if (!group) throw new NotFoundException('Group not found');
    await this.lecturerScope.assertTeaches(user, dto.sectionId);

    const enrolled: string[] = [];
    const skipped: { studentCode: string; nameEn: string; reason: string }[] = [];
    for (const { student } of group.members) {
      try {
        await this.enrollments.create(user, { sectionId: dto.sectionId, studentId: student.id });
        enrolled.push(student.studentCode);
      } catch (err) {
        skipped.push({
          studentCode: student.studentCode,
          nameEn: student.nameEn,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    await this.prisma.auditLog.create({
      data: {
        universityId: user.universityId, userId: user.id, action: AuditAction.UPDATE,
        entityType: 'Enrollment',
        metadata: { action: 'enrollGroup', groupId: id, sectionId: dto.sectionId, enrolled: enrolled.length, skipped: skipped.length },
      },
    });
    return { groupId: id, sectionId: dto.sectionId, enrolled: enrolled.length, skipped };
  }
}
