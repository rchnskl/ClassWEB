import { Module } from '@nestjs/common';
import { TimetableController } from './timetable.controller';
import { TimetableService } from './timetable.service';
import { AssessmentModule } from '../assessment/assessment.module';

@Module({
  imports: [AssessmentModule],
  controllers: [TimetableController],
  providers: [TimetableService],
})
export class TimetableModule {}
