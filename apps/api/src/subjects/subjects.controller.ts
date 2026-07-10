import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto, QuerySubjectDto, UpdateSubjectDto } from './dto/subject.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('subjects')
@ApiBearerAuth()
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Get()
  @Permissions('subject:read')
  @ApiOperation({ summary: 'List subjects (tenant-scoped, searchable, paginated)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QuerySubjectDto) {
    return this.subjects.list(user.universityId, query);
  }

  @Get(':id')
  @Permissions('subject:read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.subjects.get(user.universityId, id);
  }

  @Post()
  @Permissions('subject:create')
  @ApiOperation({ summary: 'Create a subject' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSubjectDto) {
    return this.subjects.create(user.universityId, dto);
  }

  @Patch(':id')
  @Permissions('subject:update')
  @ApiOperation({ summary: 'Update a subject' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSubjectDto) {
    return this.subjects.update(user.universityId, id, dto);
  }

  @Delete(':id')
  @Permissions('subject:delete')
  @ApiOperation({ summary: 'Delete a subject (blocked if sections exist)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.subjects.remove(user.universityId, id);
  }
}
