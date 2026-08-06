import { Module } from '@nestjs/common';
import { SubjectsController } from './subjects.controller';
import { SubjectsService } from './subjects.service';
import { SubjectMembershipService } from './subject-membership.service';

@Module({
  controllers: [SubjectsController],
  providers: [SubjectsService, SubjectMembershipService],
})
export class SubjectsModule {}
