import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({ imports: [RbacModule], controllers: [TasksController], providers: [TasksService] })
export class TasksModule {}
