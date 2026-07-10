import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';

/**
 * Read access to the academic hierarchy needed to populate selectors
 * (programs, academic years, semesters). All tenant-scoped.
 */
@Injectable()
export class AcademicService {
  constructor(private readonly prisma: PrismaService) {}

  private departmentSelect = {
    id: true, code: true, nameEn: true, nameTh: true, isActive: true,
    faculty: { select: { id: true, code: true, nameEn: true } },
    head: { select: { id: true, nameEn: true, nameTh: true } },
    _count: { select: { lecturers: true } },
  } as const;

  departments(universityId: string) {
    return this.prisma.department.findMany({
      where: { deletedAt: null, faculty: { universityId } },
      select: this.departmentSelect,
      orderBy: { code: 'asc' },
    });
  }

  async createDepartment(universityId: string, dto: CreateDepartmentDto) {
    const faculty = await this.prisma.faculty.findFirst({ where: { id: dto.facultyId, universityId }, select: { id: true } });
    if (!faculty) throw new BadRequestException('Faculty does not exist in this tenant');

    if (dto.headId) {
      const head = await this.prisma.lecturer.findFirst({ where: { id: dto.headId, universityId, deletedAt: null }, select: { id: true } });
      if (!head) throw new BadRequestException('Head lecturer does not exist in this tenant');
    }

    const clash = await this.prisma.department.findFirst({ where: { facultyId: dto.facultyId, code: dto.code, deletedAt: null } });
    if (clash) throw new ConflictException(`Department code ${dto.code} already exists in this faculty`);

    return this.prisma.department.create({
      data: {
        faculty: { connect: { id: dto.facultyId } },
        code: dto.code,
        nameEn: dto.nameEn,
        nameTh: dto.nameTh,
        ...(dto.headId ? { head: { connect: { id: dto.headId } } } : {}),
      },
      select: this.departmentSelect,
    });
  }

  async updateDepartment(universityId: string, id: string, dto: UpdateDepartmentDto) {
    const department = await this.prisma.department.findFirst({ where: { id, deletedAt: null, faculty: { universityId } } });
    if (!department) throw new NotFoundException('Department not found');

    if (dto.headId) {
      const head = await this.prisma.lecturer.findFirst({ where: { id: dto.headId, universityId, deletedAt: null }, select: { id: true } });
      if (!head) throw new BadRequestException('Head lecturer does not exist in this tenant');
    }
    if (dto.code) {
      const clash = await this.prisma.department.findFirst({
        where: { facultyId: department.facultyId, code: dto.code, deletedAt: null, NOT: { id } },
      });
      if (clash) throw new ConflictException(`Department code ${dto.code} already exists in this faculty`);
    }

    return this.prisma.department.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
        ...(dto.headId !== undefined && { head: dto.headId ? { connect: { id: dto.headId } } : { disconnect: true } }),
      },
      select: this.departmentSelect,
    });
  }

  async removeDepartment(universityId: string, id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, deletedAt: null, faculty: { universityId } },
      select: { id: true, _count: { select: { lecturers: true } } },
    });
    if (!department) throw new NotFoundException('Department not found');
    if (department._count.lecturers > 0) {
      throw new ConflictException(`This department has ${department._count.lecturers} lecturer(s) assigned and cannot be deleted`);
    }
    await this.prisma.department.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }

  courses(universityId: string, programId?: string) {
    return this.prisma.course.findMany({
      where: { deletedAt: null, isActive: true, program: { faculty: { universityId } }, ...(programId ? { programId } : {}) },
      select: { id: true, code: true, nameEn: true, nameTh: true, programId: true },
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
