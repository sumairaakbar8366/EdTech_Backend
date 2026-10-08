import { Module } from '@nestjs/common';
import { CommunicationModule } from '../communication/communication.module.js';
import { DocumentRequestsController } from './document-requests.controller.js';
import { DocumentRequestsService } from './document-requests.service.js';

@Module({
  imports: [CommunicationModule],
  controllers: [DocumentRequestsController],
  providers: [DocumentRequestsService],
})
export class DocumentRequestsModule {}
