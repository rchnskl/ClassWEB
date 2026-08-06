import { Module } from '@nestjs/common';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { StudentsRepository } from './students.repository';
import { StudentsImportService } from './students-import.service';

@Module({
  controllers: [StudentsController],
  providers: [StudentsService, StudentsRepository, StudentsImportService],
  exports: [StudentsService],
})
export class StudentsModule {}
