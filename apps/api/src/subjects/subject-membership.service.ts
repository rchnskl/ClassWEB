import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SubjectMemberRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';
import { AddTeamMemberDto, JoinSubjectDto } from './dto/subject-membership.dto';

const MAX_COURSE_MANAGERS = 2;

const memberSelect = {
  id: true,
  role: true,
  createdAt: true,
  lecturer: { select: { id: true, employeeCode: true, nameEn: true, nameTh: true, userId: true } },
  invitedBy: { select: { id: true, nameEn: true } },
} satisfies Prisma.SubjectMembershipSelect;

/**
 * Subject-level teaching-team membership. COURSE_MANAGER (max 2) runs the
 * whole subject — sections, schedule, room, full grade sheet. TEAM_MEMBER
 * just gets subject-level visibility; their actual write access to a given
 * section still runs through the existing SectionLecturer relationship,
 * which a manager assigns separately.
 *
 * The 2-manager cap can't be expressed as a DB constraint (it's a count, not
 * a uniqueness rule), so a concurrent self-join race is closed with a
 * Postgres advisory lock scoped to the subject id — two lecturers hitting
 * "join as manager" in the same instant serialize instead of both slipping
 * past a stale count check.
 */
@Injectable()
export class SubjectMembershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lecturerScope: LecturerScopeService,
  ) {}

  async list(universityId: string, subjectId: string) {
    await this.assertSubjectInTenant(universityId, subjectId);
    return this.prisma.subjectMembership.findMany({
      where: { subjectId },
      select: memberSelect,
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Self-service: a lecturer joins a subject's team, choosing their own role. */
  async join(user: AuthenticatedUser, subjectId: string, dto: JoinSubjectDto) {
    await this.assertSubjectInTenant(user.universityId, subjectId);
    const me = await this.lecturerScope.myLecturerId(user);
    if (!me) throw new ForbiddenException('Your account is not linked to a lecturer record');
    return this.addMember(subjectId, me, dto.role, null);
  }

  /** Course Manager pulls another lecturer into the team directly. */
  async addTeamMember(user: AuthenticatedUser, subjectId: string, dto: AddTeamMemberDto) {
    await this.lecturerScope.assertManagesSubject(user, subjectId);
    const lecturer = await this.prisma.lecturer.findFirst({
      where: { id: dto.lecturerId, universityId: user.universityId, deletedAt: null },
      select: { id: true },
    });
    if (!lecturer) throw new BadRequestException('Lecturer does not exist in this tenant');
    const inviterId = this.lecturerScope.isAdmin(user) ? null : await this.lecturerScope.myLecturerId(user);
    return this.addMember(subjectId, dto.lecturerId, dto.role, inviterId);
  }

  async removeMember(user: AuthenticatedUser, subjectId: string, lecturerId: string) {
    await this.lecturerScope.assertManagesSubject(user, subjectId);
    const { count } = await this.prisma.subjectMembership.deleteMany({ where: { subjectId, lecturerId } });
    if (count === 0) throw new NotFoundException('This lecturer is not a member of this subject');
    return { subjectId, lecturerId, removed: true };
  }

  private async addMember(subjectId: string, lecturerId: string, role: SubjectMemberRole, invitedById: string | null) {
    return this.prisma.$transaction(async (tx) => {
      // Advisory lock scoped to this subject — serializes concurrent joins
      // against this subject so the manager-count check below can't race.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subjectId}))`;

      const existing = await tx.subjectMembership.findUnique({
        where: { subjectId_lecturerId: { subjectId, lecturerId } },
        select: { role: true },
      });
      if (existing) {
        throw new ConflictException(
          existing.role === 'COURSE_MANAGER'
            ? 'This lecturer is already the course manager for this subject'
            : 'This lecturer is already on this subject\'s teaching team',
        );
      }

      if (role === 'COURSE_MANAGER') {
        const managerCount = await tx.subjectMembership.count({ where: { subjectId, role: 'COURSE_MANAGER' } });
        if (managerCount >= MAX_COURSE_MANAGERS) {
          throw new ConflictException(`This subject already has the maximum of ${MAX_COURSE_MANAGERS} course managers`);
        }
      }

      return tx.subjectMembership.create({
        data: { subjectId, lecturerId, role, invitedById },
        select: memberSelect,
      });
    });
  }

  private async assertSubjectInTenant(universityId: string, subjectId: string) {
    const subject = await this.prisma.subject.findFirst({
      where: { id: subjectId, deletedAt: null, program: { faculty: { universityId } } },
      select: { id: true },
    });
    if (!subject) throw new NotFoundException('Subject not found');
  }
}
