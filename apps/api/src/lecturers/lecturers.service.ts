import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLecturerDto, QueryLecturerDto, UpdateLecturerDto } from './dto/lecturer.dto';
import { Paginated } from '../common/dto/pagination.dto';
import { generateTempPassword } from '../common/temp-password';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';

@Injectable()
export class LecturersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lecturerScope: LecturerScopeService,
  ) {}

  private select = {
    id: true, employeeCode: true, nameEn: true, nameTh: true, position: true,
    email: true, phone: true, office: true, isActive: true, userId: true,
    department: { select: { id: true, code: true, nameEn: true } },
    _count: { select: { primarySections: true } },
  } satisfies Prisma.LecturerSelect;

  /**
   * A lecturer only sees colleagues they actually work with — teammates on a
   * shared subject, or co-teachers on a section — not the whole faculty
   * roster. Admin sees everyone.
   */
  async list(user: AuthenticatedUser, query: QueryLecturerDto): Promise<Paginated<unknown>> {
    const universityId = user.universityId;
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
    if (!this.lecturerScope.isAdmin(user)) {
      const me = await this.lecturerScope.myLecturerId(user);
      where.id = { in: me ? await this.lecturerScope.teammateLecturerIds(me) : [] };
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.lecturer.findMany({ where, select: this.select, orderBy: { employeeCode: 'asc' }, take: query.take, skip: query.skip }),
      this.prisma.lecturer.count({ where }),
    ]);
    return { total, take: query.take, skip: query.skip, items };
  }

  async get(user: AuthenticatedUser, id: string) {
    const lecturer = await this.findByIdInTenant(user.universityId, id);
    if (!this.lecturerScope.isAdmin(user)) {
      const me = await this.lecturerScope.myLecturerId(user);
      const teammates = me ? await this.lecturerScope.teammateLecturerIds(me) : [];
      if (!teammates.includes(id)) {
        throw new ForbiddenException('You can only view lecturers on a shared subject or section');
      }
    }
    return lecturer;
  }

  /** Tenant-only lookup, no team scoping — used by the admin-only write paths below. */
  private async findByIdInTenant(universityId: string, id: string) {
    const lecturer = await this.prisma.lecturer.findFirst({
      where: { id, universityId, deletedAt: null },
      select: this.select,
    });
    if (!lecturer) throw new NotFoundException('Lecturer not found');
    return lecturer;
  }

  /**
   * Creates a Lecturer and its login User account together, in one
   * transaction — a Lecturer with no way to sign in can't do anything on
   * this platform (add their own sections, take attendance, grade), so the
   * two are no longer created as separate steps. Returns the new lecturer
   * plus a one-time temp password for the account.
   */
  async create(universityId: string, dto: CreateLecturerDto) {
    if (dto.departmentId) {
      const dept = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, faculty: { universityId } },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('Department does not exist in this tenant');
    }
    const codeClash = await this.prisma.lecturer.findFirst({
      where: { universityId, employeeCode: dto.employeeCode, deletedAt: null },
      select: { id: true },
    });
    if (codeClash) throw new ConflictException(`Employee code ${dto.employeeCode} already exists`);

    const emailClash = await this.prisma.user.findFirst({
      where: { universityId, email: dto.email, deletedAt: null },
      select: { id: true },
    });
    if (emailClash) throw new ConflictException(`A user account with email ${dto.email} already exists`);

    const role = await this.prisma.role.findFirst({ where: { universityId, code: 'LECTURER' } });
    if (!role) throw new BadRequestException('LECTURER role is not configured for this tenant');

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const lecturer = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { universityId, email: dto.email, passwordHash, status: 'ACTIVE' },
      });
      await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return tx.lecturer.create({
        data: {
          university: { connect: { id: universityId } },
          user: { connect: { id: user.id } },
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
    });

    return { ...lecturer, tempPassword };
  }

  async update(universityId: string, id: string, dto: UpdateLecturerDto) {
    await this.findByIdInTenant(universityId, id); // ensures existence + tenant ownership

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
    await this.findByIdInTenant(universityId, id);
    await this.prisma.lecturer.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    return { id, deleted: true };
  }
}
