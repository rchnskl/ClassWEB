import { Injectable } from '@nestjs/common';
import { NotificationChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailSender } from './email.sender';

interface NotifyInput {
  universityId: string;
  userId?: string | null;        // null = broadcast to the tenant
  channel?: NotificationChannel; // default SYSTEM (in-app)
  type: string;                  // e.g. STUDENT_ABSENT, BELOW_80, ATTENDANCE_SUBMITTED
  title: string;
  body?: string;
  refType?: string;
  refId?: string;
  email?: string | null;         // recipient email for the EMAIL channel
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailSender,
  ) {}

  /**
   * Create an in-app (SYSTEM) notification and best-effort dispatch external
   * channels. External delivery never blocks or fails the caller.
   */
  async notify(input: NotifyInput) {
    const channel = input.channel ?? 'SYSTEM';
    const record = await this.prisma.notification.create({
      data: {
        universityId: input.universityId,
        userId: input.userId ?? null,
        channel,
        status: channel === 'SYSTEM' ? 'SENT' : 'PENDING',
        type: input.type,
        title: input.title,
        body: input.body,
        refType: input.refType,
        refId: input.refId,
        sentAt: channel === 'SYSTEM' ? new Date() : null,
      },
    });

    if (channel === 'EMAIL' && input.email) {
      const res = await this.email.send(input.email, input.title, input.body ?? input.title);
      await this.prisma.notification.update({
        where: { id: record.id },
        data: { status: res.sent ? 'SENT' : 'FAILED', sentAt: res.sent ? new Date() : null, payload: { reason: res.reason } },
      });
    }
    return record;
  }

  private scope(universityId: string, userId: string): Prisma.NotificationWhereInput {
    // A user sees their own targeted notifications plus tenant broadcasts.
    return { universityId, OR: [{ userId }, { userId: null }] };
  }

  async list(universityId: string, userId: string, take = 20) {
    const where = this.scope(universityId, userId);
    const [items, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        select: { id: true, type: true, title: true, body: true, channel: true, readAt: true, createdAt: true, refType: true, refId: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);
    return { unread, items };
  }

  async unreadCount(universityId: string, userId: string) {
    return { unread: await this.prisma.notification.count({ where: { ...this.scope(universityId, userId), readAt: null } }) };
  }

  async markRead(universityId: string, userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, ...this.scope(universityId, userId), readAt: null },
      data: { readAt: new Date(), status: 'READ' },
    });
    return this.unreadCount(universityId, userId);
  }

  async markAllRead(universityId: string, userId: string) {
    await this.prisma.notification.updateMany({
      where: { ...this.scope(universityId, userId), readAt: null },
      data: { readAt: new Date(), status: 'READ' },
    });
    return { unread: 0 };
  }
}
