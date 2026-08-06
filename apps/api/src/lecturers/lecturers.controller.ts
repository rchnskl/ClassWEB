import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LecturersService } from './lecturers.service';
import { CreateLecturerDto, QueryLecturerDto, UpdateLecturerDto } from './dto/lecturer.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('lecturers')
@ApiBearerAuth()
@Controller('lecturers')
export class LecturersController {
  constructor(private readonly lecturers: LecturersService) {}

  @Get()
  @Permissions('lecturer:read')
  @ApiOperation({ summary: "List lecturers a non-admin can see their own teaching team; admin sees the whole tenant" })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryLecturerDto) {
    return this.lecturers.list(user, query);
  }

  @Get(':id')
  @Permissions('lecturer:read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lecturers.get(user, id);
  }

  @Post()
  @Permissions('lecturer:create')
  @ApiOperation({ summary: 'Create a lecturer' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLecturerDto) {
    return this.lecturers.create(user.universityId, dto);
  }

  @Patch(':id')
  @Permissions('lecturer:update')
  @ApiOperation({ summary: 'Update a lecturer' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateLecturerDto) {
    return this.lecturers.update(user.universityId, id, dto);
  }

  @Delete(':id')
  @Permissions('lecturer:delete')
  @ApiOperation({ summary: 'Soft-delete (deactivate) a lecturer' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.lecturers.remove(user.universityId, id);
  }
}
