import { Module } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { AssessmentModule } from '../assessment/assessment.module';

@Module({
  imports: [NotificationsModule, AssessmentModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
})
export class AttendanceModule {}
