import { Module } from '@nestjs/common';
import { StudentGroupsController } from './student-groups.controller';
import { StudentGroupsService } from './student-groups.service';
import { EnrollmentsModule } from '../enrollments/enrollments.module';

@Module({
  // Bulk group enrolment reuses EnrollmentsService so the capacity /
  // duplicate / same-subject rules live in exactly one place.
  imports: [EnrollmentsModule],
  controllers: [StudentGroupsController],
  providers: [StudentGroupsService],
})
export class StudentGroupsModule {}
