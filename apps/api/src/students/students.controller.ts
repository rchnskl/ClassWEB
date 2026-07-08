import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { QueryStudentDto } from './dto/query-student.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('students')
@ApiBearerAuth()
@Controller('students')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get()
  @Permissions('student:read')
  @ApiOperation({ summary: 'List students (tenant-scoped, searchable, paginated)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryStudentDto) {
    return this.students.list(user.universityId, query);
  }

  @Get(':id')
  @Permissions('student:read')
  @ApiOperation({ summary: 'Get a student by id' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.students.get(user.universityId, id);
  }

  @Post()
  @Permissions('student:create')
  @ApiOperation({ summary: 'Create a student' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStudentDto) {
    return this.students.create(user.universityId, dto);
  }

  @Patch(':id')
  @Permissions('student:update')
  @ApiOperation({ summary: 'Update a student' })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.students.update(user.universityId, id, dto);
  }

  @Delete(':id')
  @Permissions('student:delete')
  @ApiOperation({ summary: 'Soft-delete a student' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.students.remove(user.universityId, id);
  }
}
