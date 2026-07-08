import { PartialType } from '@nestjs/swagger';
import { CreateStudentDto } from './create-student.dto';

// All fields optional for PATCH; studentCode/programId can be updated too.
export class UpdateStudentDto extends PartialType(CreateStudentDto) {}
