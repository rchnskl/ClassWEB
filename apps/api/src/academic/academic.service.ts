import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/department.dto';
import { CreateCourseDto, UpdateCourseDto } from './dto/course.dto';
import { CreateAcademicYearDto, UpdateAcademicYearDto } from './dto/academic-year.dto';
import { CreateSemesterDto, UpdateSemesterDto } from './dto/semester.dto';
import { CreateProgramDto, UpdateProgramDto } from './dto/program.dto';

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

  private courseSelect = {
    id: true, code: true, nameEn: true, nameTh: true, description: true, programId: true,
    program: { select: { id: true, code: true, nameEn: true } },
    _count: { select: { subjects: true } },
  } as const;

  courses(universityId: string, programId?: string) {
    return this.prisma.course.findMany({
      where: { deletedAt: null, isActive: true, program: { faculty: { universityId } }, ...(programId ? { programId } : {}) },
      select: { id: true, code: true, nameEn: true, nameTh: true, programId: true },
      orderBy: { code: 'asc' },
    });
  }

  async createCourse(universityId: string, dto: CreateCourseDto) {
    const program = await this.prisma.program.findFirst({ where: { id: dto.programId, deletedAt: null, faculty: { universityId } }, select: { id: true } });
    if (!program) throw new BadRequestException('Program does not exist in this tenant');

    const clash = await this.prisma.course.findFirst({ where: { programId: dto.programId, code: dto.code, deletedAt: null } });
    if (clash) throw new ConflictException(`Course code ${dto.code} already exists in this program`);

    return this.prisma.course.create({
      data: {
        program: { connect: { id: dto.programId } },
        code: dto.code,
        nameEn: dto.nameEn,
        nameTh: dto.nameTh,
        description: dto.description,
      },
      select: this.courseSelect,
    });
  }

  async updateCourse(universityId: string, id: string, dto: UpdateCourseDto) {
    const course = await this.prisma.course.findFirst({ where: { id, deletedAt: null, program: { faculty: { universityId } } } });
    if (!course) throw new NotFoundException('Course not found');

    if (dto.code) {
      const clash = await this.prisma.course.findFirst({
        where: { programId: course.programId, code: dto.code, deletedAt: null, NOT: { id } },
      });
      if (clash) throw new ConflictException(`Course code ${dto.code} already exists in this program`);
    }

    return this.prisma.course.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
      select: this.courseSelect,
    });
  }

  async removeCourse(universityId: string, id: string) {
    const course = await this.prisma.course.findFirst({
      where: { id, deletedAt: null, program: { faculty: { universityId } } },
      select: { id: true, _count: { select: { subjects: true } } },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course._count.subjects > 0) {
      throw new ConflictException(`This course has ${course._count.subjects} subject(s) assigned and cannot be deleted`);
    }
    await this.prisma.course.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }

  private programSelect = {
    id: true, code: true, nameEn: true, nameTh: true, degreeType: true, durationYrs: true, totalCredits: true,
    faculty: { select: { id: true, code: true, nameEn: true } },
    _count: { select: { courses: true, subjects: true, students: true } },
  } as const;

  programs(universityId: string) {
    return this.prisma.program.findMany({
      where: { deletedAt: null, faculty: { universityId } },
      select: this.programSelect,
      orderBy: { code: 'asc' },
    });
  }

  async createProgram(universityId: string, dto: CreateProgramDto) {
    const faculty = await this.prisma.faculty.findFirst({ where: { id: dto.facultyId, universityId }, select: { id: true } });
    if (!faculty) throw new BadRequestException('Faculty does not exist in this tenant');

    const clash = await this.prisma.program.findFirst({ where: { facultyId: dto.facultyId, code: dto.code, deletedAt: null } });
    if (clash) throw new ConflictException(`Program code ${dto.code} already exists in this faculty`);

    return this.prisma.program.create({
      data: {
        faculty: { connect: { id: dto.facultyId } },
        code: dto.code,
        nameEn: dto.nameEn,
        nameTh: dto.nameTh,
        degreeType: dto.degreeType,
        durationYrs: dto.durationYrs,
        totalCredits: dto.totalCredits,
      },
      select: this.programSelect,
    });
  }

  async updateProgram(universityId: string, id: string, dto: UpdateProgramDto) {
    const program = await this.prisma.program.findFirst({ where: { id, deletedAt: null, faculty: { universityId } } });
    if (!program) throw new NotFoundException('Program not found');

    if (dto.code) {
      const clash = await this.prisma.program.findFirst({
        where: { facultyId: program.facultyId, code: dto.code, deletedAt: null, NOT: { id } },
      });
      if (clash) throw new ConflictException(`Program code ${dto.code} already exists in this faculty`);
    }

    return this.prisma.program.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
        ...(dto.degreeType !== undefined && { degreeType: dto.degreeType }),
        ...(dto.durationYrs !== undefined && { durationYrs: dto.durationYrs }),
        ...(dto.totalCredits !== undefined && { totalCredits: dto.totalCredits }),
      },
      select: this.programSelect,
    });
  }

  async removeProgram(universityId: string, id: string) {
    const program = await this.prisma.program.findFirst({
      where: { id, deletedAt: null, faculty: { universityId } },
      select: { id: true, _count: { select: { courses: true, subjects: true, students: true } } },
    });
    if (!program) throw new NotFoundException('Program not found');
    const { courses, subjects, students } = program._count;
    if (courses > 0 || subjects > 0 || students > 0) {
      throw new ConflictException(`This program has ${courses} course(s), ${subjects} subject(s) and ${students} student(s) and cannot be deleted`);
    }
    await this.prisma.program.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }

  private academicYearSelect = {
    id: true, code: true, nameEn: true, nameTh: true, startDate: true, endDate: true, isCurrent: true, isActive: true,
  } as const;

  academicYears(universityId: string) {
    return this.prisma.academicYear.findMany({
      where: { universityId, deletedAt: null },
      select: this.academicYearSelect,
      orderBy: { code: 'desc' },
    });
  }

  async createAcademicYear(universityId: string, dto: CreateAcademicYearDto) {
    const clash = await this.prisma.academicYear.findFirst({ where: { universityId, code: dto.code, deletedAt: null } });
    if (clash) throw new ConflictException(`Academic year ${dto.code} already exists`);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) await tx.academicYear.updateMany({ where: { universityId, isCurrent: true }, data: { isCurrent: false } });
      return tx.academicYear.create({
        data: {
          university: { connect: { id: universityId } },
          code: dto.code,
          nameEn: dto.nameEn,
          nameTh: dto.nameTh,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          isCurrent: dto.isCurrent ?? false,
        },
        select: this.academicYearSelect,
      });
    });
  }

  async updateAcademicYear(universityId: string, id: string, dto: UpdateAcademicYearDto) {
    const year = await this.prisma.academicYear.findFirst({ where: { id, universityId, deletedAt: null } });
    if (!year) throw new NotFoundException('Academic year not found');

    if (dto.code) {
      const clash = await this.prisma.academicYear.findFirst({ where: { universityId, code: dto.code, deletedAt: null, NOT: { id } } });
      if (clash) throw new ConflictException(`Academic year ${dto.code} already exists`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) await tx.academicYear.updateMany({ where: { universityId, isCurrent: true, NOT: { id } }, data: { isCurrent: false } });
      return tx.academicYear.update({
        where: { id },
        data: {
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
          ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
          ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
          ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
          ...(dto.isCurrent !== undefined && { isCurrent: dto.isCurrent }),
        },
        select: this.academicYearSelect,
      });
    });
  }

  async removeAcademicYear(universityId: string, id: string) {
    const year = await this.prisma.academicYear.findFirst({
      where: { id, universityId, deletedAt: null },
      select: { id: true, _count: { select: { semesters: true } } },
    });
    if (!year) throw new NotFoundException('Academic year not found');
    if (year._count.semesters > 0) {
      throw new ConflictException(`This academic year has ${year._count.semesters} semester(s) and cannot be deleted`);
    }
    await this.prisma.academicYear.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }

  private semesterSelect = {
    id: true, type: true, nameEn: true, nameTh: true, startDate: true, endDate: true, addDropDeadline: true, isCurrent: true, isActive: true,
    academicYear: { select: { id: true, code: true } },
  } as const;

  semesters(universityId: string) {
    return this.prisma.semester.findMany({
      where: { deletedAt: null, academicYear: { universityId } },
      select: this.semesterSelect,
      orderBy: { startDate: 'desc' },
    });
  }

  async createSemester(universityId: string, dto: CreateSemesterDto) {
    const year = await this.prisma.academicYear.findFirst({ where: { id: dto.academicYearId, universityId, deletedAt: null }, select: { id: true } });
    if (!year) throw new BadRequestException('Academic year does not exist in this tenant');

    const clash = await this.prisma.semester.findFirst({ where: { academicYearId: dto.academicYearId, type: dto.type, deletedAt: null } });
    if (clash) throw new ConflictException(`A ${dto.type} semester already exists for this academic year`);

    return this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) await tx.semester.updateMany({ where: { academicYear: { universityId }, isCurrent: true }, data: { isCurrent: false } });
      return tx.semester.create({
        data: {
          academicYear: { connect: { id: dto.academicYearId } },
          type: dto.type,
          nameEn: dto.nameEn,
          nameTh: dto.nameTh,
          startDate: new Date(dto.startDate),
          endDate: new Date(dto.endDate),
          addDropDeadline: dto.addDropDeadline ? new Date(dto.addDropDeadline) : undefined,
          isCurrent: dto.isCurrent ?? false,
        },
        select: this.semesterSelect,
      });
    });
  }

  async updateSemester(universityId: string, id: string, dto: UpdateSemesterDto) {
    const semester = await this.prisma.semester.findFirst({ where: { id, deletedAt: null, academicYear: { universityId } } });
    if (!semester) throw new NotFoundException('Semester not found');

    if (dto.type) {
      const clash = await this.prisma.semester.findFirst({
        where: { academicYearId: semester.academicYearId, type: dto.type, deletedAt: null, NOT: { id } },
      });
      if (clash) throw new ConflictException(`A ${dto.type} semester already exists for this academic year`);
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isCurrent) await tx.semester.updateMany({ where: { academicYear: { universityId }, isCurrent: true, NOT: { id } }, data: { isCurrent: false } });
      return tx.semester.update({
        where: { id },
        data: {
          ...(dto.type !== undefined && { type: dto.type }),
          ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
          ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
          ...(dto.startDate !== undefined && { startDate: new Date(dto.startDate) }),
          ...(dto.endDate !== undefined && { endDate: new Date(dto.endDate) }),
          ...(dto.addDropDeadline !== undefined && { addDropDeadline: dto.addDropDeadline ? new Date(dto.addDropDeadline) : null }),
          ...(dto.isCurrent !== undefined && { isCurrent: dto.isCurrent }),
        },
        select: this.semesterSelect,
      });
    });
  }

  async removeSemester(universityId: string, id: string) {
    const semester = await this.prisma.semester.findFirst({
      where: { id, deletedAt: null, academicYear: { universityId } },
      select: { id: true, _count: { select: { sections: true } } },
    });
    if (!semester) throw new NotFoundException('Semester not found');
    if (semester._count.sections > 0) {
      throw new ConflictException(`This semester has ${semester._count.sections} section(s) and cannot be deleted`);
    }
    await this.prisma.semester.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }
}
