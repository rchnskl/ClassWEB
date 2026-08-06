import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { StudentsService } from './students.service';
import { StudentsImportService } from './students-import.service';
import { ImportStudentsDto } from './dto/import-student.dto';
import { PromoteYearDto } from './dto/promote-year.dto';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { LookupStudentDto, QueryStudentDto } from './dto/query-student.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('students')
@ApiBearerAuth()
@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly importer: StudentsImportService,
  ) {}

  @Get('import/template.xlsx')
  @Permissions('student:create')
  @ApiOperation({ summary: 'Download the roster import template (.xlsx) with the expected columns' })
  async template(@Res() res: Response) {
    const buffer = await this.importer.template();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="classweb-student-import-template.xlsx"');
    res.send(buffer);
  }

  @Post('import')
  @Permissions('student:create')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'programId'],
      properties: {
        file: { type: 'string', format: 'binary' },
        programId: { type: 'string' },
        yearLevel: { type: 'integer', minimum: 1, maximum: 8 },
        onDuplicate: { type: 'string', enum: ['SKIP', 'UPDATE'] },
        commit: { type: 'boolean', default: false },
      },
    },
  })
  @ApiOperation({
    summary: 'Import a roster from Excel',
    description:
      'Defaults to a dry run: every row is validated and returned with its row number and errors, and nothing is written. Send commit=true to apply. A file with any remaining errors is rejected whole — never half-imported.',
  })
  import(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: { buffer: Buffer; originalname?: string; size?: number },
    @Body() dto: ImportStudentsDto,
  ) {
    return this.importer.run(user, file, dto);
  }

  @Post('promote-year')
  @Permissions('student:update')
  @ApiOperation({
    summary: 'Advance a cohort to the next year of study',
    description:
      'Only STUDYING students move; those on leave or suspended stay put. A cohort already at the final year is marked graduated. Defaults to a dry run — send commit=true to apply.',
  })
  promoteYear(@CurrentUser() user: AuthenticatedUser, @Body() dto: PromoteYearDto) {
    return this.students.promoteYear(user, dto);
  }

  @Get()
  @Permissions('student:read')
  @ApiOperation({ summary: 'List students (tenant-scoped, searchable, paginated)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryStudentDto) {
    return this.students.list(user, query);
  }

  @Get('lookup')
  @Permissions('enrollment:create')
  @ApiOperation({
    summary: 'Search the central roster to build sections/groups',
    description:
      'Returns identifying fields only (code, name, year, program) so a lecturer can find a student they do not yet teach. Requires a search term, year level, or program — it cannot dump the roster.',
  })
  lookup(@CurrentUser() user: AuthenticatedUser, @Query() query: LookupStudentDto) {
    return this.students.lookup(user, query);
  }

  @Get(':id')
  @Permissions('student:read')
  @ApiOperation({ summary: 'Get a student by id' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.students.get(user, id);
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
