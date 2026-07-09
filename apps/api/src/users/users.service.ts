import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findProfile(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        universityId: true,
        status: true,
        lastLoginAt: true,
        roles: { select: { role: { select: { code: true, nameEn: true, nameTh: true } } } },
        lecturer: { select: { id: true, nameEn: true, nameTh: true, employeeCode: true } },
        student: { select: { id: true, nameEn: true, nameTh: true, studentCode: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Tenant-scoped listing: results are always constrained to the caller's
   * university — the core multi-tenant isolation guarantee.
   */
  async listByTenant(universityId: string, take = 50, skip = 0) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { universityId, deletedAt: null },
        select: { id: true, email: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.user.count({ where: { universityId, deletedAt: null } }),
    ]);
    return { total, take, skip, items };
  }
}
