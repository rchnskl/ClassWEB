import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TimetableService } from './timetable.service';
import { CreateDatedSessionsDto, CreateScheduleDto, GenerateSessionsDto, TimetableQueryDto, UpdateSessionDto } from './dto/timetable.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('timetable')
@ApiBearerAuth()
@Controller('timetable')
export class TimetableController {
  constructor(private readonly timetable: TimetableService) {}

  @Get()
  @Permissions('timetable:read')
  @ApiOperation({ summary: 'Weekly timetable slots for a semester (defaults to current)' })
  get(@CurrentUser() user: AuthenticatedUser, @Query() query: TimetableQueryDto) {
    return this.timetable.timetable(user, query.semesterId);
  }

  @Post('schedules')
  @Permissions('timetable:create')
  @ApiOperation({ summary: 'Add a weekly schedule slot (room/teacher/section conflict-checked)' })
  createSchedule(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateScheduleDto) {
    return this.timetable.createSchedule(user, dto);
  }

  @Post('generate')
  @Permissions('timetable:create')
  @ApiOperation({ summary: 'Expand a section schedule into concrete class sessions' })
  generate(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateSessionsDto) {
    return this.timetable.generateSessions(user, dto);
  }

  @Post('sessions')
  @Permissions('timetable:create')
  @ApiOperation({ summary: 'Create class sessions on specific dates (e.g. clinical practicum days); room/teacher clash-checked per day' })
  createSessions(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDatedSessionsDto) {
    return this.timetable.createDatedSessions(user, dto);
  }

  @Patch('sessions/:id')
  @Permissions('timetable:update')
  @ApiOperation({ summary: "Edit a session's topic or whether it is a day for daily assessment" })
  updateSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSessionDto) {
    return this.timetable.updateSession(user, id, dto);
  }

  @Get('sessions')
  @Permissions('timetable:read')
  @ApiOperation({ summary: 'List class sessions (filter by section, one date, or a from/to date range)' })
  sessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sectionId') sectionId?: string,
    @Query('date') date?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.timetable.sessions(user, sectionId, date, from, to);
  }
}
