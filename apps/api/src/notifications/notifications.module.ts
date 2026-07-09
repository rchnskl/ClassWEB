import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailSender } from './email.sender';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailSender],
  exports: [NotificationsService],
})
export class NotificationsModule {}
