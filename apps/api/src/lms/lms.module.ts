import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { StorageService } from '../storage/storage.service.js';
import { LmsController } from './lms.controller.js';
import { LmsService } from './lms.service.js';

@Module({
  imports: [RbacModule],
  controllers: [LmsController],
  providers: [LmsService, StorageService],
})
export class LmsModule {}
