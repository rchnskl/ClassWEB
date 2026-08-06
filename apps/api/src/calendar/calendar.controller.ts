import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CalendarService } from './calendar.service';
import { CreateCalendarEntryDto, QueryCalendarDto } from './dto/calendar.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(private readonly calendar: CalendarService) {}

  @Get('entries')
  @Permissions('timetable:read')
  @ApiOperation({ summary: "List calendar entries overlapping a date range (another user's PRIVATE entries are excluded)" })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryCalendarDto) {
    return this.calendar.list(user.universityId, user.id, query);
  }

  @Post('entries')
  @Permissions('timetable:create')
  @ApiOperation({ summary: 'Create a calendar entry (class / personal / activity / meeting)' })
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCalendarEntryDto) {
    return this.calendar.create(user.universityId, user.id, dto);
  }

  @Delete('entries/:id')
  @Permissions('timetable:delete')
  @ApiOperation({ summary: 'Delete a calendar entry (a PRIVATE entry can only be deleted by its owner or admin)' })
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.calendar.remove(user.universityId, user.id, user.roleCodes.includes('ADMIN'), id);
  }
}
