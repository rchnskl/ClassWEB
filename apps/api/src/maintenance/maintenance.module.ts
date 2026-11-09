import { Module } from '@nestjs/common';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { ResetService } from './reset.service';

@Module({
  controllers: [MaintenanceController],
  providers: [MaintenanceService, ResetService],
})
export class MaintenanceModule {}
