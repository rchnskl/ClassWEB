import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StudentGroupsService } from './student-groups.service';
import {
  AddGroupMembersDto, AutoSplitDto, CreateStudentGroupDto, EnrollGroupDto,
  QueryStudentGroupDto, UpdateStudentGroupDto,
} from './dto/student-group.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('student-groups')
@ApiBearerAuth()
@Controller('student-groups')
export class StudentGroupsController {
  constructor(private readonly groups: StudentGroupsService) {}

  @Get()
  @Permissions('enrollment:read')
  @ApiOperation({ summary: 'List groups (central cohorts + section sub-groups you can see)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryStudentGroupDto) {
    return this.groups.list(user, query);
  }

  @Get(':id')
  @Permissions('enrollment:read')
  @ApiOperation({ summary: 'Group detail with its member list' })
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.groups.get(user, id);
  }

  @Post()
  @Permissions('enrollment:create')
  @ApiOperation({ summary: 'Create a group. CENTRAL scope is admin-only; SECTION scope requires teaching that section.' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStudentGroupDto) {
    return this.groups.create(user, dto);
  }

  @Post('auto-split')
  @Permissions('enrollment:create')
  @ApiOperation({ summary: 'Create N groups and distribute a cohort (or a section roster) evenly across them' })
  autoSplit(@CurrentUser() user: AuthenticatedUser, @Body() dto: AutoSplitDto) {
    return this.groups.autoSplit(user, dto);
  }

  @Patch(':id')
  @Permissions('enrollment:update')
  @ApiOperation({ summary: 'Rename / reorder / deactivate a group' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateStudentGroupDto) {
    return this.groups.update(user, id, dto);
  }

  @Delete(':id')
  @Permissions('enrollment:update')
  @ApiOperation({ summary: 'Delete a group (members are unlinked; enrolments are untouched)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.groups.remove(user, id);
  }

  @Post(':id/members')
  @Permissions('enrollment:update')
  @ApiOperation({ summary: 'Add students to a group (one or many; already-present ids are ignored)' })
  addMembers(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddGroupMembersDto) {
    return this.groups.addMembers(user, id, dto);
  }

  @Delete(':id/members/:studentId')
  @Permissions('enrollment:update')
  @ApiOperation({ summary: 'Remove one student from a group' })
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.groups.removeMember(user, id, studentId);
  }

  @Post(':id/enroll')
  @Permissions('enrollment:create')
  @ApiOperation({ summary: 'Enrol every member of the group into a section (partial success is reported per student)' })
  enroll(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: EnrollGroupDto) {
    return this.groups.enrollIntoSection(user, id, dto);
  }
}
