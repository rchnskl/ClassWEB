import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SectionsService } from './sections.service';
import { CreateSectionDto, QuerySectionDto, UpdateSectionDto } from './dto/section.dto';
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
    return this.sections.list(user, query);
  }

  @Get(':id')
  @Permissions('section:read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sections.get(user, id);
  }

  @Post()
  @Permissions('section:create')
  @ApiOperation({ summary: 'Create a section. Lecturers may only create a section taught by themselves.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSectionDto) {
    return this.sections.create(user, dto);
  }

  @Patch(':id')
  @Permissions('section:update')
  @ApiOperation({ summary: 'Update a section. Lecturers may only manage sections they teach.' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSectionDto) {
    return this.sections.update(user, id, dto);
  }

  @Delete(':id')
  @Permissions('section:delete')
  @ApiOperation({ summary: 'Delete a section (blocked if students are enrolled)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.sections.remove(user, id);
  }
}
