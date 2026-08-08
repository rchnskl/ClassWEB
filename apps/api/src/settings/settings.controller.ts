import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { BulkUpsertSettingsDto, UpdateAttendanceRuleDto } from './dto/settings.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Permissions('setting:read')
  @ApiOperation({ summary: 'List tenant settings (theme, system name, PDF header/footer, …)' })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.list(user.universityId);
  }

  @Patch()
  @Permissions('setting:update')
  @ApiOperation({ summary: 'Upsert one or more settings' })
  upsert(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkUpsertSettingsDto) {
    return this.settings.bulkUpsert(user.universityId, dto);
  }

  @Get('branding')
  @ApiOperation({ summary: 'App name + theme colors — readable by any authenticated user, not just setting:read holders' })
  branding(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getBranding(user.universityId);
  }

  @Get('attendance-rule')
  @Permissions('setting:read')
  @ApiOperation({ summary: 'University-wide default attendance rule' })
  getRule(@CurrentUser() user: AuthenticatedUser) {
    return this.settings.getAttendanceRule(user.universityId);
  }

  @Patch('attendance-rule')
  @Permissions('setting:update')
  @ApiOperation({ summary: 'Edit the university-wide default attendance rule' })
  updateRule(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAttendanceRuleDto) {
    return this.settings.updateAttendanceRule(user.universityId, dto);
  }
}
