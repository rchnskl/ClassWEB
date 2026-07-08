import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
 * Real, tenant-scoped aggregate queries for the dashboard. No mocked numbers —
 * every figure is computed from the database for the caller's university.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(universityId: string): Promise<DashboardSummary> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const [students, lecturers, sections, enrollments, todayClasses, atRiskStudents, rateAgg] =
      await this.prisma.$transaction([
        this.prisma.student.count({
          where: { universityId, deletedAt: null, status: 'STUDYING' },
        }),
        this.prisma.lecturer.count({ where: { universityId, deletedAt: null, isActive: true } }),
        this.prisma.section.count({ where: { universityId, deletedAt: null, isActive: true } }),
        this.prisma.enrollment.count({
          where: { status: 'ENROLLED', section: { universityId } },
        }),
        this.prisma.classSession.count({
          where: {
            section: { universityId },
            sessionDate: { gte: startOfDay, lt: endOfDay },
            status: { in: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'MAKEUP'] },
          },
        }),
        this.prisma.enrollment.count({
          where: { status: 'ENROLLED', section: { universityId }, attendanceRate: { lt: 80 } },
        }),
        this.prisma.enrollment.aggregate({
          where: { status: 'ENROLLED', section: { universityId }, attendanceRate: { not: null } },
          _avg: { attendanceRate: true },
        }),
      ]);

    return {
      students,
      lecturers,
      sections,
      enrollments,
      todayClasses,
      atRiskStudents,
      attendanceRate: rateAgg._avg.attendanceRate,
      generatedAt: new Date().toISOString(),
    };
  }
}
