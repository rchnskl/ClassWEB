import { Module } from '@nestjs/common';
import { StudentNotesController } from './student-notes.controller';
import { StudentNotesService } from './student-notes.service';

@Module({
  controllers: [StudentNotesController],
  providers: [StudentNotesService],
})
export class StudentNotesModule {}
