import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AttendanceService } from './attendance.service';
import { CheckInDto, ManualMarkDto, ResolveCheckInDto } from './dto/attendance.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('attendance')
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  // ---- lecturer / admin ------------------------------------------------

  @Post('sessions/:classSessionId/open')
  @ApiBearerAuth()
  @Permissions('attendance:create')
  @ApiOperation({ summary: 'Open attendance for a class session and mint a QR token' })
  open(@CurrentUser() user: AuthenticatedUser, @Param('classSessionId') id: string) {
    return this.attendance.open(user.universityId, user.id, id);
  }

  @Post('sessions/:classSessionId/close')
  @ApiBearerAuth()
  @Permissions('attendance:update')
  @ApiOperation({ summary: 'Close attendance for a class session' })
  close(@CurrentUser() user: AuthenticatedUser, @Param('classSessionId') id: string) {
    return this.attendance.close(user.universityId, id);
  }

  @Get('sessions/:classSessionId')
  @ApiBearerAuth()
  @Permissions('attendance:read')
  @ApiOperation({ summary: 'Attendance state: roster, counts, open token, pending check-ins' })
  state(@CurrentUser() user: AuthenticatedUser, @Param('classSessionId') id: string) {
    return this.attendance.state(user.universityId, id);
  }

  @Post('records')
  @ApiBearerAuth()
  @Permissions('attendance:update')
  @ApiOperation({ summary: 'Manually mark a student present/late/absent' })
  manual(@CurrentUser() user: AuthenticatedUser, @Body() dto: ManualMarkDto) {
    return this.attendance.manualMark(user.universityId, user.id, dto);
  }

  @Post('checkins/:id/resolve')
  @ApiBearerAuth()
  @Permissions('attendance:update')
  @ApiOperation({ summary: 'Resolve a pending check-in with a reason' })
  resolve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: ResolveCheckInDto) {
    return this.attendance.resolve(user.universityId, user.id, id, dto);
  }

  // ---- student self check-in (public, authorised by the QR token) ------

  @Public()
  @Get('checkin/:token')
  @ApiOperation({ summary: 'Session context for the student check-in page' })
  context(@Param('token') token: string) {
    return this.attendance.checkInContext(token);
  }

  @Public()
  @Post('checkin')
  @ApiOperation({ summary: 'Student submits their student code to check in' })
  checkin(@Body() dto: CheckInDto, @Req() req: Request) {
    return this.attendance.checkIn(dto.token, dto.studentCode, req.ip, dto.confirm ?? false);
  }
}
