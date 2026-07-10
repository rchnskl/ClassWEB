import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuditAction } from '@prisma/client';
import { AuditService } from './audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Permissions('audit:read')
  @ApiOperation({ summary: 'List audit log entries (filterable, paginated)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
    @Query('action') action?: AuditAction,
    @Query('entityType') entityType?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.audit.list(user.universityId, {
      take: take ? parseInt(take, 10) : undefined,
      skip: skip ? parseInt(skip, 10) : undefined,
      action, entityType, userId, from, to,
    });
  }

  @Get('facets')
  @Permissions('audit:read')
  @ApiOperation({ summary: 'Distinct action/entity-type values for filter dropdowns' })
  facets(@CurrentUser() user: AuthenticatedUser) {
    return this.audit.facets(user.universityId);
  }
}
