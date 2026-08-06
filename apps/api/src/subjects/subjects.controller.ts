import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubjectsService } from './subjects.service';
import { SubjectMembershipService } from './subject-membership.service';
import { CreateSubjectDto, QuerySubjectDto, UpdateSubjectDto } from './dto/subject.dto';
import { AddTeamMemberDto, JoinSubjectDto } from './dto/subject-membership.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';
import { LecturerScopeService } from '../common/lecturer-scope.service';

@ApiTags('subjects')
@ApiBearerAuth()
@Controller('subjects')
export class SubjectsController {
  constructor(
    private readonly subjects: SubjectsService,
    private readonly memberships: SubjectMembershipService,
    private readonly lecturerScope: LecturerScopeService,
  ) {}

  @Get()
  @Permissions('subject:read')
  @ApiOperation({ summary: 'List subjects (tenant-scoped, searchable, paginated)' })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QuerySubjectDto) {
    return this.subjects.list(user.universityId, query);
  }

  @Get('mine/memberships')
  @Permissions('subject:read')
  @ApiOperation({ summary: "The caller's own subject memberships — which subjects they manage vs. are a team member of" })
  async myMemberships(@CurrentUser() user: AuthenticatedUser) {
    const me = await this.lecturerScope.myLecturerId(user);
    if (!me) return { managed: [], member: [] };
    const [managed, member] = await Promise.all([
      this.lecturerScope.managedSubjectIds(me),
      this.lecturerScope.memberSubjectIds(me),
    ]);
    return { managed, member };
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

  // ---- teaching-team membership (Course Manager / Team Member) -----------

  @Get(':id/members')
  @Permissions('subject:read')
  @ApiOperation({ summary: "A subject's teaching team (course managers + team members)" })
  listMembers(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.memberships.list(user.universityId, id);
  }

  @Post(':id/join')
  @Permissions('section:create')
  @ApiOperation({ summary: 'Self-service: join a subject\'s teaching team as course manager or team member' })
  join(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: JoinSubjectDto) {
    return this.memberships.join(user, id, dto);
  }

  @Post(':id/team')
  @Permissions('section:create')
  @ApiOperation({ summary: 'Course manager pulls a lecturer from the central roster into the teaching team' })
  addTeamMember(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: AddTeamMemberDto) {
    return this.memberships.addTeamMember(user, id, dto);
  }

  @Delete(':id/team/:lecturerId')
  @Permissions('section:create')
  @ApiOperation({ summary: 'Course manager removes a lecturer from the teaching team' })
  removeTeamMember(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Param('lecturerId') lecturerId: string) {
    return this.memberships.removeMember(user, id, lecturerId);
  }
}
