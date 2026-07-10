import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { TokenService } from '../auth/token.service';
import { generateTempPassword } from '../common/temp-password';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
  ) {}

  private profileSelect = {
    id: true,
    email: true,
    universityId: true,
    status: true,
    lastLoginAt: true,
    lineUserId: true,
    roles: { select: { role: { select: { code: true, nameEn: true, nameTh: true } } } },
    lecturer: { select: { id: true, nameEn: true, nameTh: true, employeeCode: true } },
    student: { select: { id: true, nameEn: true, nameTh: true, studentCode: true } },
  } as const;

  async findProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: this.profileSelect,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(userId: string, dto: { lineUserId?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { ...(dto.lineUserId !== undefined && { lineUserId: dto.lineUserId || null }) },
      select: this.profileSelect,
    });
  }

  /**
   * Tenant-scoped listing: results are always constrained to the caller's
   * university — the core multi-tenant isolation guarantee.
   */
  async listByTenant(universityId: string, take = 50, skip = 0) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { universityId, deletedAt: null },
        select: {
          id: true, email: true, status: true, lastLoginAt: true, createdAt: true,
          roles: { select: { role: { select: { code: true, nameEn: true, nameTh: true } } } },
          lecturer: { select: { nameEn: true, nameTh: true, employeeCode: true } },
          student: { select: { nameEn: true, nameTh: true, studentCode: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.user.count({ where: { universityId, deletedAt: null } }),
    ]);
    return { total, take, skip, items };
  }

  /** Available roles for the tenant, for a role picker. */
  listRoles(universityId: string) {
    return this.prisma.role.findMany({
      where: { universityId },
      select: { code: true, nameEn: true, nameTh: true },
      orderBy: { code: 'asc' },
    });
  }

  /** Lecturers who don't yet have a login account — candidates to link a new user to. */
  linkableLecturers(universityId: string) {
    return this.prisma.lecturer.findMany({
      where: { universityId, deletedAt: null, userId: null },
      select: { id: true, employeeCode: true, nameEn: true, nameTh: true },
      orderBy: { employeeCode: 'asc' },
    });
  }

  /** Students who don't yet have a login account. */
  linkableStudents(universityId: string) {
    return this.prisma.student.findMany({
      where: { universityId, deletedAt: null, userId: null },
      select: { id: true, studentCode: true, nameEn: true, nameTh: true },
      orderBy: { studentCode: 'asc' },
    });
  }

  private async resolveRole(universityId: string, roleCode: string) {
    const role = await this.prisma.role.findFirst({ where: { universityId, code: roleCode } });
    if (!role) throw new NotFoundException(`Role ${roleCode} does not exist in this tenant`);
    return role;
  }

  /** Admin-creates a login for a new or existing person. Returns the temp password once — it is never stored in plaintext or logged. */
  async createUser(universityId: string, dto: CreateUserDto) {
    const clash = await this.prisma.user.findFirst({ where: { universityId, email: dto.email, deletedAt: null } });
    if (clash) throw new ConflictException(`A user with email ${dto.email} already exists`);

    const role = await this.resolveRole(universityId, dto.roleCode);

    if (dto.lecturerId) {
      const lecturer = await this.prisma.lecturer.findFirst({ where: { id: dto.lecturerId, universityId, deletedAt: null } });
      if (!lecturer) throw new NotFoundException('Lecturer not found in this tenant');
      if (lecturer.userId) throw new ConflictException('This lecturer already has a login account');
    }
    if (dto.studentId) {
      const student = await this.prisma.student.findFirst({ where: { id: dto.studentId, universityId, deletedAt: null } });
      if (!student) throw new NotFoundException('Student not found in this tenant');
      if (student.userId) throw new ConflictException('This student already has a login account');
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { universityId, email: dto.email, passwordHash, status: 'ACTIVE' },
      });
      await tx.userRole.create({ data: { userId: created.id, roleId: role.id } });
      if (dto.lecturerId) await tx.lecturer.update({ where: { id: dto.lecturerId }, data: { userId: created.id } });
      if (dto.studentId) await tx.student.update({ where: { id: dto.studentId }, data: { userId: created.id } });
      return created;
    });

    return { id: user.id, email: user.email, tempPassword };
  }

  async updateUser(universityId: string, userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, universityId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.roleCode) {
      const role = await this.resolveRole(universityId, dto.roleCode);
      await this.prisma.$transaction([
        this.prisma.userRole.deleteMany({ where: { userId } }),
        this.prisma.userRole.create({ data: { userId, roleId: role.id } }),
      ]);
    }
    if (dto.status) {
      await this.prisma.user.update({ where: { id: userId }, data: { status: dto.status } });
    }
    return this.findProfile(userId);
  }

  /** Admin-issued password reset. Returns the new temp password once; revokes all of the user's sessions. */
  async resetPassword(universityId: string, userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, universityId, deletedAt: null } });
    if (!user) throw new NotFoundException('User not found');

    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    await this.tokenService.revokeAllForUser(userId);
    return { tempPassword };
  }
}
