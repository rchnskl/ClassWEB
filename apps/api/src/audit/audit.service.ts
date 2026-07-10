import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface AuditQuery {
  take?: number;
  skip?: number;
  action?: AuditAction;
  entityType?: string;
  userId?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(universityId: string, q: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      universityId,
      ...(q.action ? { action: q.action } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
    };
    const take = Math.min(q.take ?? 50, 200);
    const skip = q.skip ?? 0;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true, action: true, entityType: true, entityId: true, metadata: true,
          ipAddress: true, userAgent: true, createdAt: true,
          user: { select: { email: true } },
        },
        orderBy: { createdAt: 'desc' },
        take, skip,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { total, take, skip, items };
  }

  /** Distinct action types + entity types present, to populate filter dropdowns. */
  async facets(universityId: string) {
    const [actions, entityTypes] = await Promise.all([
      this.prisma.auditLog.findMany({ where: { universityId }, distinct: ['action'], select: { action: true } }),
      this.prisma.auditLog.findMany({ where: { universityId, entityType: { not: null } }, distinct: ['entityType'], select: { entityType: true } }),
    ]);
    return {
      actions: actions.map((a) => a.action),
      entityTypes: entityTypes.map((e) => e.entityType).filter((e): e is string => !!e),
    };
  }
}
