import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLecturerDto, QueryLecturerDto, UpdateLecturerDto } from './dto/lecturer.dto';
import { Paginated } from '../common/dto/pagination.dto';

@Injectable()
export class LecturersService {
  constructor(private readonly prisma: PrismaService) {}

  private select = {
    id: true, employeeCode: true, nameEn: true, nameTh: true, position: true,
    email: true, phone: true, office: true, isActive: true,
    department: { select: { id: true, code: true, nameEn: true } },
    _count: { select: { primarySections: true } },
  } satisfies Prisma.LecturerSelect;

  async list(universityId: string, query: QueryLecturerDto): Promise<Paginated<unknown>> {
    const where: Prisma.LecturerWhereInput = {
      universityId, deletedAt: null,
      ...(query.search
        ? { OR: [
            { nameEn: { contains: query.search, mode: 'insensitive' } },
            { nameTh: { contains: query.search, mode: 'insensitive' } },
            { employeeCode: { contains: query.search, mode: 'insensitive' } },
          ] }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lecturer.findMany({ where, select: this.select, orderBy: { employeeCode: 'asc' }, take: query.take, skip: query.skip }),
      this.prisma.lecturer.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  async get(universityId: string, id: string) {
    const lecturer = await this.prisma.lecturer.findFirst({
      where: { id, universityId, deletedAt: null },
      select: this.select,
    });
    if (!lecturer) throw new NotFoundException('Lecturer not found');
    return lecturer;
  }

  async create(universityId: string, dto: CreateLecturerDto) {
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, faculty: { universityId } },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('Department does not exist in this tenant');
    }
    const clash = await this.prisma.lecturer.findFirst({
      where: { universityId, employeeCode: dto.employeeCode, deletedAt: null },
      select: { id: true },
    });
    if (clash) throw new ConflictException(`Employee code ${dto.employeeCode} already exists`);

    return this.prisma.lecturer.create({
      data: {
        university: { connect: { id: universityId } },
        employeeCode: dto.employeeCode,
        nameEn: dto.nameEn,
        nameTh: dto.nameTh,
        position: dto.position,
        email: dto.email,
        phone: dto.phone,
        office: dto.office,
        ...(dto.departmentId ? { department: { connect: { id: dto.departmentId } } } : {}),
      },
      select: this.select,
    });
  }

  async update(universityId: string, id: string, dto: UpdateLecturerDto) {
    await this.get(universityId, id); // ensures existence + tenant ownership

    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, faculty: { universityId } },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('Department does not exist in this tenant');
    }
    if (dto.employeeCode) {
      const clash = await this.prisma.lecturer.findFirst({
        where: { universityId, employeeCode: dto.employeeCode, deletedAt: null, NOT: { id } },
        select: { id: true },
      });
      if (clash) throw new ConflictException(`Employee code ${dto.employeeCode} already exists`);
    }

    return this.prisma.lecturer.update({
      where: { id },
      data: {
        ...(dto.employeeCode !== undefined && { employeeCode: dto.employeeCode }),
        ...(dto.nameEn !== undefined && { nameEn: dto.nameEn }),
        ...(dto.nameTh !== undefined && { nameTh: dto.nameTh }),
        ...(dto.position !== undefined && { position: dto.position }),
        ...(dto.email !== undefined && { email: dto.email }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.office !== undefined && { office: dto.office }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.departmentId !== undefined && {
          department: dto.departmentId ? { connect: { id: dto.departmentId } } : { disconnect: true },
        }),
      },
      select: this.select,
    });
  }

  async remove(universityId: string, id: string) {
    await this.get(universityId, id);
    await this.prisma.lecturer.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }
}
