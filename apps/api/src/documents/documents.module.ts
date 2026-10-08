import { Global, Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { StorageService } from '../storage/storage.service.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';

@Global()
@Module({
  imports: [RbacModule],
  controllers: [DocumentsController],
  providers: [StorageService, DocumentsService],
  exports: [StorageService, DocumentsService],
})
export class DocumentsModule {}
