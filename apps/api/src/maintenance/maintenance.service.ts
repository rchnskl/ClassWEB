import { Injectable } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A stuck backup job older than this is treated as dead, not still running. */
const STUCK_BACKUP_AGE_MS = 2 * 60 * 60 * 1000;
/** Audit log rows older than this are pure history — no operational value left. */
const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export interface MaintenancePreview {
  sessionsToEnd: number;
  staleRefreshTokens: number;
  openCheckInWindows: number;
  stuckBackups: number;
  oldAuditLogs: number;
}

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Counts what a refresh would touch, without touching anything — shown to
   * the admin before they commit to an action that logs out every signed-in
   * user in the tenant.
   */
  async preview(universityId: string): Promise<MaintenancePreview> {
    const now = new Date();
    const [refreshTokens, openSessions, stuckBackups, oldAuditLogs] = await Promise.all([
      this.prisma.refreshToken.count({ where: { user: { universityId } } }),
      this.prisma.attendanceSession.count({
        where: { isOpen: true, expiresAt: { lt: now }, classSession: { section: { universityId } } },
      }),
      this.prisma.backup.count({
        where: { universityId, status: 'IN_PROGRESS', startedAt: { lt: new Date(now.getTime() - STUCK_BACKUP_AGE_MS) } },
      }),
      this.prisma.auditLog.count({
        where: { universityId, createdAt: { lt: new Date(now.getTime() - AUDIT_RETENTION_MS) } },
      }),
    ]);
    return {
      sessionsToEnd: openSessions,
      staleRefreshTokens: refreshTokens,
      openCheckInWindows: openSessions,
      stuckBackups,
      oldAuditLogs,
    };
  }

  /**
   * Signs every user in the tenant out (deletes every refresh token — active
   * or already dead — so there is nothing left to rotate), closes attendance
   * check-in windows nobody remembered to close, marks backup jobs that never
   * finished as failed instead of leaving them "in progress" forever, and
   * prunes audit log rows past the retention window.
   *
   * Deleting refresh tokens outright (rather than just setting revokedAt)
   * does double duty: it forces logout AND clears the dead rows in one pass.
   * A currently-valid access token keeps working for up to its own 15-minute
   * TTL after this runs — that tail is accepted rather than adding an extra
   * epoch column to force immediate revocation.
   */
  async refresh(universityId: string, actorId: string) {
    const now = new Date();

    const [{ count: loggedOut }, { count: sessionsEnded }, stuckBackups, { count: auditPruned }] = await Promise.all([
      this.prisma.refreshToken.deleteMany({ where: { user: { universityId } } }),
      this.prisma.attendanceSession.updateMany({
        where: { isOpen: true, expiresAt: { lt: now }, classSession: { section: { universityId } } },
        data: { isOpen: false, closedAt: now },
      }),
      this.prisma.backup.findMany({
        where: { universityId, status: 'IN_PROGRESS', startedAt: { lt: new Date(now.getTime() - STUCK_BACKUP_AGE_MS) } },
        select: { id: true },
      }),
      this.prisma.auditLog.deleteMany({
        where: { universityId, createdAt: { lt: new Date(now.getTime() - AUDIT_RETENTION_MS) } },
      }),
    ]);

    if (stuckBackups.length > 0) {
      await this.prisma.backup.updateMany({
        where: { id: { in: stuckBackups.map((b) => b.id) } },
        data: { status: 'FAILED', error: 'Marked failed by system maintenance — exceeded the maximum expected run time.' },
      });
    }

    const result = {
      loggedOutSessions: loggedOut,
      attendanceWindowsClosed: sessionsEnded,
      backupsMarkedFailed: stuckBackups.length,
      auditLogsPruned: auditPruned,
      ranAt: now,
    };

    await this.prisma.auditLog.create({
      data: {
        universityId,
        userId: actorId,
        action: AuditAction.SETTINGS_CHANGE,
        entityType: 'Maintenance',
        metadata: { action: 'systemRefresh', ...result, ranAt: now.toISOString() },
      },
    });

    return result;
  }
}
