import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { toDateOnly } from '../common/date-only.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateTaskDto, TaskStatusDto } from './tasks.dto.js';

type Status = 'todo' | 'in_progress' | 'done';
const INCLUDE = { employee: { select: { id: true, firstName: true, lastName: true, designation: true, staffType: true } } } as const;
const ORDER = [{ status: 'asc' as const }, { dueDate: { sort: 'asc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }];

/** Tasks administrators assign to staff (non-teaching staff "Assigned Tasks"). */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  list(schoolId: string, status?: Status) {
    return this.prisma.forSchool(schoolId).staffTask.findMany({ where: status ? { status } : {}, orderBy: ORDER, include: INCLUDE, take: 300 });
  }

  async mine(schoolId: string, userId: string) {
    const db = this.prisma.forSchool(schoolId);
    const employee = await db.employee.findUnique({ where: { userId }, select: { id: true } });
    if (!employee) return [];
    return db.staffTask.findMany({ where: { employeeId: employee.id }, orderBy: ORDER });
  }

  async create(schoolId: string, dto: CreateTaskDto, actorUserId: string) {
    const db = this.prisma.forSchool(schoolId);
    const employee = await db.employee.findUnique({ where: { id: dto.employeeId }, select: { id: true, userId: true } });
    if (!employee) throw new NotFoundException('Staff member not found');
    const task = await db.staffTask.create({
      data: {
        schoolId,
        employeeId: dto.employeeId,
        title: dto.title,
        details: dto.details ?? null,
        priority: dto.priority ?? 'normal',
        dueDate: dto.dueDate ? toDateOnly(dto.dueDate) : null,
        assignedBy: actorUserId,
      },
      include: INCLUDE,
    });
    await this.notifications.notify(schoolId, [employee.userId], { eventType: 'task_assigned', title: `New task: ${dto.title}`, body: dto.details?.slice(0, 280) ?? null, link: '/assigned-tasks' });
    return task;
  }

  /** The assignee moves their own task along; an administrator can change any task. */
  async setStatus(schoolId: string, id: string, dto: TaskStatusDto, actorUserId: string, isManager: boolean) {
    const db = this.prisma.forSchool(schoolId);
    const task = await db.staffTask.findUnique({ where: { id }, include: { employee: { select: { userId: true } } } });
    if (!task) throw new NotFoundException('Task not found');
    if (!isManager && task.employee.userId !== actorUserId) throw new ForbiddenException('This task is assigned to someone else');
    return db.staffTask.update({
      where: { id },
      data: { status: dto.status, ...(dto.note !== undefined && { note: dto.note || null }), completedAt: dto.status === 'done' ? new Date() : null },
    });
  }

  async remove(schoolId: string, id: string) {
    const r = await this.prisma.forSchool(schoolId).staffTask.deleteMany({ where: { id } });
    if (!r.count) throw new NotFoundException('Task not found');
    return { ok: true };
  }
}
