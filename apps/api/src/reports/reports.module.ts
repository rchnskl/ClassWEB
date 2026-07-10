import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AssessmentModule } from '../assessment/assessment.module';

@Module({
  imports: [AnalyticsModule, AssessmentModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
