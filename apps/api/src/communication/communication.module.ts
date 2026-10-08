import { Global, Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { AnnouncementsController, MessagesController, NotificationsController } from './communication.controller.js';
import { CommunicationService } from './communication.service.js';
import { NotificationsService } from './notifications.service.js';

/** Global so any module can raise notifications by injecting NotificationsService. */
@Global()
@Module({
  imports: [RbacModule],
  controllers: [NotificationsController, AnnouncementsController, MessagesController],
  providers: [NotificationsService, CommunicationService],
  exports: [NotificationsService],
})
export class CommunicationModule {}
