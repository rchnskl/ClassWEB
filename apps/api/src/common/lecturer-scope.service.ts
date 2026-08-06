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
}
