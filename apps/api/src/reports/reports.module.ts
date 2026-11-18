import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AssessmentModule } from '../assessment/assessment.module';
import { SettingsModule } from '../settings/settings.module';
import { AttendanceModule } from '../attendance/attendance.module';

@Module({
  imports: [AnalyticsModule, AssessmentModule, SettingsModule, AttendanceModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
