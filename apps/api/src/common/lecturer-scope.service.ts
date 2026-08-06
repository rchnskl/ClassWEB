import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from './authenticated-user';

/**
 * Central place for "does this lecturer teach that section?" checks. ADMIN
 * bypasses every check here — everything below only restricts the LECTURER
 * role. Rubric templates are deliberately NOT scoped by this service; they're
 * a shared catalogue every lecturer may browse/select regardless of what
 * they teach.
 */
@Injectable()
export class LecturerScopeService {
  constructor(private readonly prisma: PrismaService) {}

  isAdmin(user: AuthenticatedUser): boolean {
    return user.roleCodes.includes('ADMIN');
  }

  /** Resolves the caller's own Lecturer.id, if their account is linked to one. */
  async myLecturerId(user: AuthenticatedUser): Promise<string | null> {
    const lecturer = await this.prisma.lecturer.findFirst({
      where: { universityId: user.universityId, userId: user.id, deletedAt: null },
      select: { id: true },
    });
    return lecturer?.id ?? null;
  }

  /** All section ids this lecturer teaches, as primary or co-lecturer. */
  async sectionIdsFor(lecturerId: string): Promise<string[]> {
    const [primary, co] = await Promise.all([
      this.prisma.section.findMany({ where: { lecturerId, deletedAt: null }, select: { id: true } }),
      this.prisma.sectionLecturer.findMany({ where: { lecturerId }, select: { sectionId: true } }),
    ]);
    return [...new Set([...primary.map((s) => s.id), ...co.map((s) => s.sectionId)])];
  }

  async teachesSection(lecturerId: string, sectionId: string): Promise<boolean> {
    const [primary, co] = await Promise.all([
      this.prisma.section.findFirst({ where: { id: sectionId, lecturerId, deletedAt: null }, select: { id: true } }),
      this.prisma.sectionLecturer.findFirst({ where: { sectionId, lecturerId }, select: { id: true } }),
    ]);
    return Boolean(primary || co);
  }

  /**
   * Throws unless the caller is an admin or teaches the given section.
   * Returns null for admins (no restriction), or the caller's own
   * lecturerId otherwise — callers that need it can reuse the value.
   */
  async assertTeaches(user: AuthenticatedUser, sectionId: string): Promise<string | null> {
    if (this.isAdmin(user)) return null;
    const me = await this.myLecturerId(user);
    if (!me || !(await this.teachesSection(me, sectionId))) {
      throw new ForbiddenException('You can only access sections you teach');
    }
    return me;
  }

  // ---- subject membership (Course Manager / Team Member) ------------------

  /** Subject ids this lecturer is a COURSE_MANAGER of (max 2 managers per subject, enforced on write). */
  async managedSubjectIds(lecturerId: string): Promise<string[]> {
    const rows = await this.prisma.subjectMembership.findMany({
      where: { lecturerId, role: 'COURSE_MANAGER' },
      select: { subjectId: true },
    });
    return rows.map((r) => r.subjectId);
  }

  /** Subject ids this lecturer is a member of, in any role (manager or team). */
  async memberSubjectIds(lecturerId: string): Promise<string[]> {
    const rows = await this.prisma.subjectMembership.findMany({
      where: { lecturerId },
      select: { subjectId: true },
    });
    return rows.map((r) => r.subjectId);
  }

  async isSubjectManager(user: AuthenticatedUser, subjectId: string): Promise<boolean> {
    if (this.isAdmin(user)) return true;
    const me = await this.myLecturerId(user);
    if (!me) return false;
    const row = await this.prisma.subjectMembership.findFirst({
      where: { subjectId, lecturerId: me, role: 'COURSE_MANAGER' },
      select: { id: true },
    });
    return Boolean(row);
  }

  /** Throws unless the caller is an admin or a COURSE_MANAGER of this subject. */
  async assertManagesSubject(user: AuthenticatedUser, subjectId: string): Promise<void> {
    if (!(await this.isSubjectManager(user, subjectId))) {
      throw new ForbiddenException('You must be a course manager of this subject');
    }
  }

  /**
   * Every section id this lecturer can act on: sections they personally
   * teach (primary/co-lecturer), plus — since a Course Manager runs the
   * whole subject, not just the sections they happen to also teach —
   * every section under a subject they manage.
   */
  async accessibleSectionIds(user: AuthenticatedUser): Promise<string[]> {
    if (this.isAdmin(user)) return [];
    const me = await this.myLecturerId(user);
    if (!me) return [];
    const [taught, managedSubjectIds] = await Promise.all([this.sectionIdsFor(me), this.managedSubjectIds(me)]);
    if (managedSubjectIds.length === 0) return taught;
    const managedSections = await this.prisma.section.findMany({
      where: { subjectId: { in: managedSubjectIds }, deletedAt: null },
      select: { id: true },
    });
    return [...new Set([...taught, ...managedSections.map((s) => s.id)])];
  }

  /**
   * Throws unless the caller is an admin, teaches the section directly, or
   * manages the section's subject as Course Manager. Returns null for
   * admins, or the caller's own lecturerId otherwise.
   */
  async assertTeachesOrManages(user: AuthenticatedUser, sectionId: string): Promise<string | null> {
    if (this.isAdmin(user)) return null;
    const me = await this.myLecturerId(user);
    if (!me) throw new ForbiddenException('Your account is not linked to a lecturer record');
    if (await this.teachesSection(me, sectionId)) return me;
    const section = await this.prisma.section.findFirst({ where: { id: sectionId }, select: { subjectId: true } });
    if (section && (await this.isSubjectManager(user, section.subjectId))) return me;
    throw new ForbiddenException('You can only access sections you teach or manage');
  }

  /**
   * Lecturer ids "on the same team" as this lecturer: co-members of any
   * subject they belong to, plus co-teachers (primary/co-lecturer) of any
   * section they teach. Includes the caller themselves. Used to scope the
   * Lecturers directory for non-admins — a lecturer should see colleagues
   * they actually work with, not the whole faculty roster.
   */
  async teammateLecturerIds(lecturerId: string): Promise<string[]> {
    const [mySubjectIds, mySectionIds] = await Promise.all([
      this.memberSubjectIds(lecturerId),
      this.sectionIdsFor(lecturerId),
    ]);

    const [subjectTeammates, sectionPrimaries, sectionCoTeachers] = await Promise.all([
      mySubjectIds.length
        ? this.prisma.subjectMembership.findMany({ where: { subjectId: { in: mySubjectIds } }, select: { lecturerId: true } })
        : Promise.resolve([]),
      mySectionIds.length
        ? this.prisma.section.findMany({ where: { id: { in: mySectionIds }, lecturerId: { not: null } }, select: { lecturerId: true } })
        : Promise.resolve([]),
      mySectionIds.length
        ? this.prisma.sectionLecturer.findMany({ where: { sectionId: { in: mySectionIds } }, select: { lecturerId: true } })
        : Promise.resolve([]),
    ]);

    return [...new Set([
      lecturerId,
      ...subjectTeammates.map((m) => m.lecturerId),
      ...sectionPrimaries.map((s) => s.lecturerId as string),
      ...sectionCoTeachers.map((s) => s.lecturerId),
    ])];
  }
}
