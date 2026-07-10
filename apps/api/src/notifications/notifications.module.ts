import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailSender } from './email.sender';
import { LineSender } from './line.sender';
import { PushSender } from './push.sender';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailSender, LineSender, PushSender],
  exports: [NotificationsService],
})
export class NotificationsModule {}
