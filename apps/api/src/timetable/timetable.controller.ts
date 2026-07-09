import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TimetableService } from './timetable.service';
import { CreateScheduleDto, GenerateSessionsDto, TimetableQueryDto } from './dto/timetable.dto';
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
    return this.timetable.timetable(user.universityId, query.semesterId);
  }

  @Post('schedules')
  @Permissions('timetable:create')
  @ApiOperation({ summary: 'Add a weekly schedule slot (room/teacher/section conflict-checked)' })
  createSchedule(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateScheduleDto) {
    return this.timetable.createSchedule(user.universityId, dto);
  }

  @Post('generate')
  @Permissions('timetable:create')
  @ApiOperation({ summary: 'Expand a section schedule into concrete class sessions' })
  generate(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateSessionsDto) {
    return this.timetable.generateSessions(user.universityId, dto);
  }

  @Get('sessions')
  @Permissions('timetable:read')
  @ApiOperation({ summary: 'List class sessions (filter by section and/or date)' })
  sessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('sectionId') sectionId?: string,
    @Query('date') date?: string,
  ) {
    return this.timetable.sessions(user.universityId, sectionId, date);
  }
}
