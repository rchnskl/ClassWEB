import { Module } from '@nestjs/common';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';
import { BackupsScheduler } from './backups.scheduler';

@Module({
  controllers: [BackupsController],
  providers: [BackupsService, BackupsScheduler],
})
export class BackupsModule {}
