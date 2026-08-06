import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSectionDto, QuerySectionDto, UpdateSectionDto } from './dto/section.dto';
import { Paginated } from '../common/dto/pagination.dto';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';

@Injectable()
export class SectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lecturerScope: LecturerScopeService,
  ) {}

  private select = {
    id: true, sectionNo: true, capacity: true, currentEnrollment: true, isActive: true,
    subject: { select: { id: true, code: true, nameEn: true, credits: true } },
    semester: { select: { id: true, nameEn: true, academicYear: { select: { code: true } } } },
    lecturer: { select: { id: true, nameEn: true, employeeCode: true, userId: true } },
    room: { select: { id: true, roomNumber: true } },
    _count: { select: { enrollments: true } },
  } satisfies Prisma.SectionSelect;

  async list(actingUser: AuthenticatedUser, query: QuerySectionDto): Promise<Paginated<unknown>> {
    const universityId = actingUser.universityId;
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
    if (!this.lecturerScope.isAdmin(actingUser)) {
      const sectionIds = await this.lecturerScope.accessibleSectionIds(actingUser);
      where.id = { in: sectionIds };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.section.findMany({ where, select: this.select, orderBy: [{ subject: { code: 'asc' } }, { sectionNo: 'asc' }], take: query.take, skip: query.skip }),
      this.prisma.section.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  async get(actingUser: AuthenticatedUser, id: string) {
    const universityId = actingUser.universityId;
    const section = await this.prisma.section.findFirst({
      where: { id, universityId, deletedAt: null },
      select: this.select,
    });
    if (!section) throw new NotFoundException('Section not found');
    await this.lecturerScope.assertTeachesOrManages(actingUser, id);
    return section;
  }

  /** Resolves the caller's own Lecturer record, if any (used to scope self-service section management). */
  private async myLecturer(universityId: string, userId: string) {
    return this.prisma.lecturer.findFirst({ where: { universityId, userId, deletedAt: null }, select: { id: true } });
  }

  async create(actingUser: AuthenticatedUser, dto: CreateSectionDto) {
    const universityId = actingUser.universityId;
    const isAdmin = actingUser.roleCodes.includes('ADMIN');

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

    // Creating a section is a course-manager action — it's how the manager
    // organises the subject, not something every lecturer can do to any
    // subject just by claiming themselves as the teacher. A manager may
    // assign any lecturer (pulled from the central roster) as the primary
    // lecturer, same as admin.
    if (!isAdmin) {
      await this.lecturerScope.assertManagesSubject(actingUser, dto.subjectId);
    }
    let lecturerId = dto.lecturerId;
    if (dto.lecturerId) {
      const lecturer = await this.prisma.lecturer.findFirst({
        where: { id: dto.lecturerId, universityId, deletedAt: null }, select: { id: true },
      });
      if (!lecturer) throw new BadRequestException('Lecturer does not exist in this tenant');
    } else if (!isAdmin) {
      // Default to the manager themself when they don't name a teacher.
      const me = await this.myLecturer(universityId, actingUser.id);
      lecturerId = me?.id;
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
        ...(lecturerId ? { lecturer: { connect: { id: lecturerId } } } : {}),
        ...(dto.roomId ? { room: { connect: { id: dto.roomId } } } : {}),
      },
      select: this.select,
    });
  }

  /** Throws unless the caller is an admin, the section's own lecturer, or the course manager of its subject. */
  private async assertCanManage(actingUser: AuthenticatedUser, sectionId: string) {
    const universityId = actingUser.universityId;
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, universityId, deletedAt: null },
      select: { id: true, lecturerId: true, subjectId: true },
    });
    if (!section) throw new NotFoundException('Section not found');
    if (actingUser.roleCodes.includes('ADMIN')) return section;

    const me = await this.myLecturer(universityId, actingUser.id);
    const isOwnSection = me && section.lecturerId === me.id;
    const isManager = await this.lecturerScope.isSubjectManager(actingUser, section.subjectId);
    if (!isOwnSection && !isManager) {
      throw new ForbiddenException('You can only manage sections you teach or a subject you manage');
    }
    return section;
  }

  async update(actingUser: AuthenticatedUser, id: string, dto: UpdateSectionDto) {
    const universityId = actingUser.universityId;
    const isAdmin = actingUser.roleCodes.includes('ADMIN');
    const section = await this.assertCanManage(actingUser, id);

    // A course manager may reassign the primary lecturer to anyone; a
    // lecturer acting on their own section (not as manager) may not hand it
    // off to someone else.
    if (dto.lecturerId !== undefined && !isAdmin) {
      const isManager = await this.lecturerScope.isSubjectManager(actingUser, section.subjectId);
      if (!isManager) {
        const me = await this.myLecturer(universityId, actingUser.id);
        if (!me || dto.lecturerId !== me.id) {
          throw new ForbiddenException('You cannot reassign this section to another lecturer');
        }
      }
    }
    if (dto.lecturerId) {
      const lecturer = await this.prisma.lecturer.findFirst({ where: { id: dto.lecturerId, universityId, deletedAt: null }, select: { id: true } });
      if (!lecturer) throw new BadRequestException('Lecturer does not exist in this tenant');
    }
    if (dto.roomId) {
      const room = await this.prisma.room.findFirst({ where: { id: dto.roomId, deletedAt: null, building: { campus: { universityId } } }, select: { id: true } });
      if (!room) throw new BadRequestException('Room does not exist in this tenant');
    }

    return this.prisma.section.update({
      where: { id },
      data: {
        ...(dto.sectionNo !== undefined && { sectionNo: dto.sectionNo }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.lecturerId !== undefined && { lecturer: dto.lecturerId ? { connect: { id: dto.lecturerId } } : { disconnect: true } }),
        ...(dto.roomId !== undefined && { room: dto.roomId ? { connect: { id: dto.roomId } } : { disconnect: true } }),
      },
      select: this.select,
    });
  }

  async remove(actingUser: AuthenticatedUser, id: string) {
    const section = await this.assertCanManage(actingUser, id);
    const enrolled = await this.prisma.enrollment.count({ where: { sectionId: id, status: 'ENROLLED' } });
    if (enrolled > 0) {
      throw new ConflictException(`This section has ${enrolled} enrolled student(s) and cannot be deleted`);
    }
    await this.prisma.section.update({ where: { id: section.id }, data: { deletedAt: new Date(), isActive: false } });
    return { id: section.id, deleted: true };
  }
}
