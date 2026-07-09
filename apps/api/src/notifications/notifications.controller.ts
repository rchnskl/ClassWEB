import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-user';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // Any authenticated user sees their own inbox — no special permission.
  @Get()
  @ApiOperation({ summary: 'My notifications (targeted + tenant broadcasts) with unread count' })
  list(@CurrentUser() user: AuthenticatedUser, @Query('take') take?: string) {
    return this.notifications.list(user.universityId, user.id, take ? Math.min(parseInt(take, 10) || 20, 100) : 20);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count' })
  unread(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.unreadCount(user.universityId, user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark a notification read' })
  read(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.notifications.markRead(user.universityId, user.id, id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications read' })
  readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.markAllRead(user.universityId, user.id);
  }
}
