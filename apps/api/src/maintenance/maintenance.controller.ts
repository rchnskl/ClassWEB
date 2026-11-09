import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MaintenanceService } from './maintenance.service';
import { ResetService } from './reset.service';
import { ResetDto } from './reset.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(
    private readonly maintenance: MaintenanceService,
    private readonly resets: ResetService,
  ) {}

  @Get('preview')
  @Permissions('maintenance:read')
  @ApiOperation({ summary: 'Counts of what a system refresh would touch, without changing anything' })
  preview(@CurrentUser() user: AuthenticatedUser) {
    return this.maintenance.preview(user.universityId);
  }

  @Post('refresh')
  @Permissions('maintenance:update')
  @ApiOperation({ summary: 'Sign every user in the tenant out, close stale attendance windows, resolve stuck backup jobs, prune old audit logs' })
  refresh(@CurrentUser() user: AuthenticatedUser) {
    return this.maintenance.refresh(user.universityId, user.id);
  }

  @Get('reset-preview')
  @Permissions('maintenance:read')
  @ApiOperation({ summary: 'Row counts an archive-and-reset would clear, and the phrase needed to confirm it' })
  resetPreview(@CurrentUser() user: AuthenticatedUser) {
    return this.resets.preview(user.universityId);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @Permissions('maintenance:update')
  @ApiOperation({ summary: 'Clear all teaching & assessment data for a fresh start (users, settings, structure, lecturers, rooms are kept)' })
  reset(@CurrentUser() user: AuthenticatedUser, @Body() dto: ResetDto) {
    return this.resets.reset(user.universityId, user.id, dto.confirmation, dto.archived);
  }
}
