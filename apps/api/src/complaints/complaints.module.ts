import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { ComplaintsController } from './complaints.controller.js';
import { ComplaintsService } from './complaints.service.js';

@Module({ imports: [RbacModule], controllers: [ComplaintsController], providers: [ComplaintsService], exports: [ComplaintsService] })
export class ComplaintsModule {}
