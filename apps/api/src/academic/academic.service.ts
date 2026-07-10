import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read access to the academic hierarchy needed to populate selectors
 * (programs, academic years, semesters). All tenant-scoped.
 */
@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService) {}

  departments(universityId: string) {
    return this.prisma.department.findMany({
      where: { deletedAt: null, faculty: { universityId } },
      select: { id: true, code: true, nameEn: true, nameTh: true, faculty: { select: { code: true, nameEn: true } } },
      orderBy: { code: 'asc' },
    });
  }

  programs(universityId: string) {
    return this.prisma.program.findMany({
      where: { deletedAt: null, faculty: { universityId } },
      select: { id: true, code: true, nameEn: true, nameTh: true, faculty: { select: { code: true, nameEn: true } } },
      orderBy: { code: 'asc' },
    });
  }

  academicYears(universityId: string) {
    return this.prisma.academicYear.findMany({
      where: { universityId, deletedAt: null },
      select: { id: true, code: true, nameEn: true, isCurrent: true },
      orderBy: { code: 'desc' },
    });
  }

  semesters(universityId: string) {
    return this.prisma.semester.findMany({
      where: { deletedAt: null, academicYear: { universityId } },
      select: {
        id: true, type: true, nameEn: true, isCurrent: true,
        academicYear: { select: { id: true, code: true } },
      },
      orderBy: { startDate: 'desc' },
    });
  }
}
