import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SectionsService } from './sections.service';
import { CreateSectionDto, QuerySectionDto } from './dto/section.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('sections')
@ApiBearerAuth()
@Controller('sections')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  @Get()
  @Permissions('section:read')
  @ApiOperation({ summary: 'List sections with subject/lecturer/room/enrolment (tenant-scoped)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QuerySectionDto) {
    return this.sections.list(user.universityId, query);
  }

  @Get(':id')
  @Permissions('section:read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sections.get(user.universityId, id);
  }

  @Post()
  @Permissions('section:create')
  @ApiOperation({ summary: 'Create a section' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSectionDto) {
    return this.sections.create(user.universityId, dto);
  }
}
