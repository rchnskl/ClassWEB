import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudentNotesService } from './student-notes.service';
import { CreateStudentNoteDto } from './dto/student-note.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('student-notes')
@ApiBearerAuth()
@Controller('students/:studentId/notes')
export class StudentNotesController {
  constructor(private readonly notes: StudentNotesService) {}

  @Get()
  @Permissions('note:read')
  @ApiOperation({ summary: "List a student's behaviour/daily notes (newest first)" })
  list(@CurrentUser() user: AuthenticatedUser, @Param('studentId') studentId: string) {
    return this.notes.list(user.universityId, studentId);
  }

  @Post()
  @Permissions('note:create')
  @ApiOperation({ summary: 'Record a note (stamped with recorder name + timestamp)' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('studentId') studentId: string,
    @Body() dto: CreateStudentNoteDto,
  ) {
    return this.notes.create(user.universityId, studentId, user.id, dto);
  }
}
