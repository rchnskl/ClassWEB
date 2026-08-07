import { Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MaintenanceService } from './maintenance.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

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
}
