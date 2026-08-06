import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  @Permissions('report:read')
  @ApiOperation({ summary: "Attendance analytics + at-risk students (admin: tenant-wide; lecturer: own sections only)" })
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.analytics.overview(user);
  }
}
