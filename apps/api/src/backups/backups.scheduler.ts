import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { BackupsService } from './backups.service';

const RETAIN_AUTOMATIC_BACKUPS = 14; // ~2 weeks of daily snapshots per tenant

/** Runs a daily backup for every tenant, then prunes old automatic backups beyond the retention window. */
@Injectable()
export class BackupsScheduler {
  private readonly logger = new Logger('BackupsScheduler');

  constructor(
    private readonly prisma: PrismaService,
    private readonly backups: BackupsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runDailyBackups() {
    const universities = await this.prisma.university.findMany({ select: { id: true } });
    this.logger.log(`Running scheduled backup for ${universities.length} tenant(s)`);
    for (const u of universities) {
      try {
        const backup = await this.backups.create(u.id, null, 'Scheduled daily backup', 'AUTOMATIC');
        if (backup.status !== 'COMPLETED') {
          this.logger.error(`Scheduled backup for university ${u.id} finished with status ${backup.status}: ${backup.error}`);
          continue;
        }
        const { pruned } = await this.backups.pruneOldAutomatic(u.id, RETAIN_AUTOMATIC_BACKUPS);
        this.logger.log(`University ${u.id}: backup ${backup.id} completed, pruned ${pruned} old automatic backup(s)`);
      } catch (e) {
        this.logger.error(`Scheduled backup failed for university ${u.id}: ${(e as Error).message}`);
      }
    }
  }
}
