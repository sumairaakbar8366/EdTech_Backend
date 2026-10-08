import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { hasAccess } from '@schoolerp/shared';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { PermissionService } from '../rbac/permission.service.js';
import { CreateTaskDto, TaskStatusDto } from './tasks.dto.js';
import { TasksService } from './tasks.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
const Id = () => new ParseUUIDPipe();
const STATUSES = ['todo', 'in_progress', 'done'] as const;
/** Tasks belong to the Staff module: admins manage them (staff: crud), employees see their own (staff: own). */
const Manage = () => RequireAccess('staff', ['crud']);
const Own = () => RequireAccess('staff', ['crud', 'own']);

@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly permissions: PermissionService,
  ) {}

  @Manage() @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query('status') status?: string) {
    return this.tasks.list(a.schoolId, STATUSES.find((s) => s === status));
  }

  @Own() @Get('mine')
  mine(@CurrentAuth() a: SchoolAuth) {
    return this.tasks.mine(a.schoolId, a.userId);
  }

  @Manage() @Post()
  create(@CurrentAuth() a: SchoolAuth, @Body() dto: CreateTaskDto) {
    return this.tasks.create(a.schoolId, dto, a.userId);
  }

  @Own() @Patch(':id/status')
  async status(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string, @Body() dto: TaskStatusDto) {
    const { permissions } = await this.permissions.loadUserAccess(a.schoolId, a.userId);
    return this.tasks.setStatus(a.schoolId, id, dto, a.userId, hasAccess(permissions, 'staff', ['crud']));
  }

  @Manage() @Delete(':id')
  remove(@CurrentAuth() a: SchoolAuth, @Param('id', Id()) id: string) {
    return this.tasks.remove(a.schoolId, id);
  }
}
