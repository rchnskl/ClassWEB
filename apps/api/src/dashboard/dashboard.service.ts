import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';

export interface DashboardSummary {
  students: number;
  lecturers: number;
  sections: number;
  enrollments: number;
  todayClasses: number;
  atRiskStudents: number;
  attendanceRate: number | null;
  generatedAt: string;
}

/**
 * Real, tenant- or lecturer-scoped aggregate queries for the dashboard. No
 * mocked numbers — every figure is computed from the database.
 *
 * ADMIN sees the whole tenant. A LECTURER sees the same numbers the
 * Students/Sections pages show them — their own sections only — otherwise
 * the dashboard tiles quote a faculty-wide count while every list page a
 * click away is correctly scoped to nothing, which reads as the dashboard
 * lying.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lecturerScope: LecturerScopeService,
  ) {}

  async summary(user: AuthenticatedUser): Promise<DashboardSummary> {
    const universityId = user.universityId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const isAdmin = this.lecturerScope.isAdmin(user);
    // null = no restriction (admin). A course manager's scope includes every
    // section under a subject they manage, not just sections they personally
    // teach, so the dashboard matches what they can actually act on.
    const sectionIds: string[] | null = isAdmin ? null : await this.lecturerScope.accessibleSectionIds(user);
    const sectionWhere = sectionIds ? { universityId, id: { in: sectionIds } } : { universityId };
    const enrollmentSectionWhere = sectionIds ? { universityId, id: { in: sectionIds } } : { universityId };

    const [studentGroups, lecturerCount, sections, enrollments, todayClasses, atRiskGroups, rateAgg] =
      await this.prisma.$transaction([
        // Distinct students actually enrolled in the sections in scope —
        // for a lecturer this is "students I teach", not every STUDYING
        // student in the faculty.
        this.prisma.enrollment.groupBy({
          by: ['studentId'],
          where: { status: 'ENROLLED', section: enrollmentSectionWhere },
          orderBy: { studentId: 'asc' },
        }),
        sectionIds
          ? this.prisma.sectionLecturer.findMany({ where: { sectionId: { in: sectionIds } }, distinct: ['lecturerId'], select: { lecturerId: true } })
          : this.prisma.lecturer.count({ where: { universityId, deletedAt: null, isActive: true } }),
        this.prisma.section.count({ where: { ...sectionWhere, deletedAt: null, isActive: true } }),
        this.prisma.enrollment.count({
          where: { status: 'ENROLLED', section: enrollmentSectionWhere },
        }),
        this.prisma.classSession.count({
          where: {
            section: enrollmentSectionWhere,
            sessionDate: { gte: startOfDay, lt: endOfDay },
            status: { in: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'MAKEUP'] },
          },
        }),
        // Distinct students at risk (a student is counted once even across sections).
        this.prisma.enrollment.groupBy({
          by: ['studentId'],
          where: { status: 'ENROLLED', section: enrollmentSectionWhere, attendanceRate: { lt: 80 } },
          _count: { _all: true },
          orderBy: { studentId: 'asc' },
        }),
        this.prisma.enrollment.aggregate({
          where: { status: 'ENROLLED', section: enrollmentSectionWhere, attendanceRate: { not: null } },
          _avg: { attendanceRate: true },
        }),
      ]);

    return {
      students: studentGroups.length,
      lecturers: typeof lecturerCount === 'number' ? lecturerCount : lecturerCount.length,
      sections,
      enrollments,
      todayClasses,
      atRiskStudents: atRiskGroups.length,
      attendanceRate: rateAgg._avg.attendanceRate,
      generatedAt: new Date().toISOString(),
    };
  }
}
