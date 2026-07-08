import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubjectsService } from './subjects.service';
import { CreateSubjectDto, QuerySubjectDto } from './dto/subject.dto';
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
}
