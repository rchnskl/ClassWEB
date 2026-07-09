import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type RiskTier = 'OK' | 'WARNING' | 'RISK' | 'CRITICAL';

export interface StudentAnalytics {
  studentId: string;
  studentCode: string;
  nameEn: string;
  nameTh: string | null;
  program: string;
  total: number;
  present: number;
  late: number;
  absent: number;
  rate: number;
  tier: RiskTier;
  badges: string[];
}

function tierFor(rate: number): RiskTier {
  if (rate < 60) return 'CRITICAL';
  if (rate < 70) return 'RISK';
  if (rate < 80) return 'WARNING';
  return 'OK';
}

/**
 * Attendance analytics + automatic student-risk identification, tenant-scoped.
 * Rates are computed from AttendanceRecord (PRESENT/LATE count as attended).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(universityId: string) {
    const where = { enrollment: { section: { universityId } } } as const;

    const [byStatus, totalPer, attendedPer, latePer] = await Promise.all([
      this.prisma.attendanceRecord.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.attendanceRecord.groupBy({ by: ['studentId'], where, _count: { _all: true } }),
      this.prisma.attendanceRecord.groupBy({ by: ['studentId'], where: { ...where, status: { in: ['PRESENT', 'LATE'] } }, _count: { _all: true } }),
      this.prisma.attendanceRecord.groupBy({ by: ['studentId'], where: { ...where, status: 'LATE' }, _count: { _all: true } }),
    ]);

    const attendedMap = new Map(attendedPer.map((r) => [r.studentId, r._count._all]));
    const lateMap = new Map(latePer.map((r) => [r.studentId, r._count._all]));

    const studentIds = totalPer.map((r) => r.studentId);
    const students = await this.prisma.student.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, studentCode: true, nameEn: true, nameTh: true, program: { select: { code: true } } },
    });
    const infoMap = new Map(students.map((s) => [s.id, s]));

    const rows: StudentAnalytics[] = totalPer.map((r) => {
      const total = r._count._all;
      const attended = attendedMap.get(r.studentId) ?? 0;
      const late = lateMap.get(r.studentId) ?? 0;
      const absent = total - attended;
      const present = attended - late;
      const rate = total > 0 ? Math.round((attended / total) * 1000) / 10 : 0;
      const info = infoMap.get(r.studentId);
      const tier = tierFor(rate);
      const badges: string[] = [];
      if (tier !== 'OK') badges.push(tier);
      if (absent >= 3) badges.push('CHRONIC_ABSENCE');
      if (late >= 3) badges.push('REPEATED_LATE');
      return {
        studentId: r.studentId,
        studentCode: info?.studentCode ?? '—',
        nameEn: info?.nameEn ?? '—',
        nameTh: info?.nameTh ?? null,
        program: info?.program.code ?? '—',
        total, present, late, absent, rate, tier, badges,
      };
    });

    const totals = {
      records: byStatus.reduce((a, b) => a + b._count._all, 0),
      present: byStatus.find((b) => b.status === 'PRESENT')?._count._all ?? 0,
      late: byStatus.find((b) => b.status === 'LATE')?._count._all ?? 0,
      absent: byStatus.find((b) => b.status === 'ABSENT')?._count._all ?? 0,
    };
    const risk = {
      below80: rows.filter((r) => r.rate < 80).length,
      below70: rows.filter((r) => r.rate < 70).length,
      below60: rows.filter((r) => r.rate < 60).length,
    };
    const atRisk = rows.filter((r) => r.rate < 80).sort((a, b) => a.rate - b.rate);
    const top = [...rows].sort((a, b) => b.rate - a.rate).slice(0, 5);

    return {
      totals,
      overallRate: totals.records > 0 ? Math.round(((totals.present + totals.late) / totals.records) * 1000) / 10 : null,
      studentsTracked: rows.length,
      risk,
      atRisk,
      top,
      generatedAt: new Date().toISOString(),
    };
  }
}
