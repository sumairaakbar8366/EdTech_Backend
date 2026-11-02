import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../common/request-context.js';
import { NotificationsService } from '../communication/notifications.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import { approverIds } from '../rbac/approvers.js';
import { ADMIN_TRANSITIONS, type CreateRequestDto, type ListRequestsQuery, type MoveRequestDto } from './document-requests.dto.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;

export const TYPE_LABEL: Record<string, string> = {
  marksheet: 'Marksheet',
  report_card: 'Report card',
  character_certificate: 'Character certificate',
  leaving_certificate: 'School leaving certificate',
  bonafide_certificate: 'Bonafide certificate',
  transcript: 'Transcript',
  fee_clearance: 'Fee clearance certificate',
  other: 'Other document',
};
const STATUS_TEXT: Record<string, string> = {
  in_review: 'is being processed',
  ready: 'is ready',
  completed: 'has been completed',
  rejected: 'was declined',
};

const INCLUDE = {
  student: { select: { id: true, firstName: true, lastName: true, admissionNo: true, enrollments: { where: { status: 'enrolled' as const }, take: 1, select: { section: { select: { name: true, schoolClass: { select: { name: true } } } } } } } },
  events: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.DocumentRequestInclude;

async function lock(tx: TenantTx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}

/**
 * Document requests: a parent (for their child) or a student asks the school for a marksheet,
 * certificate, etc.; the school administration reviews, prepares and hands it over.
 */
@Injectable()
export class DocumentRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(auth: SchoolAuth, dto: CreateRequestDto) {
    await this.assertRequester(auth, dto.studentId);
    const request = await this.prisma.inSchoolTransaction(auth.schoolId, async (tx) => {
      await lock(tx, `doc-req-seq:${auth.schoolId}`);
      const year = new Date().getFullYear();
      const prefix = `DR-${year}-`;
      const last = await tx.documentRequest.findFirst({ where: { requestNo: { startsWith: prefix } }, orderBy: { requestNo: 'desc' }, select: { requestNo: true } });
      const requestNo = `${prefix}${String((last ? Number(last.requestNo.slice(prefix.length)) : 0) + 1).padStart(4, '0')}`;
      const actor = await tx.user.findUnique({ where: { id: auth.userId }, select: { firstName: true, lastName: true } });
      return tx.documentRequest.create({
        data: {
          schoolId: auth.schoolId, requestNo, studentId: dto.studentId, requestedBy: auth.userId, type: dto.type, purpose: dto.purpose,
          details: dto.details ?? null, copies: dto.copies ?? 1, delivery: dto.delivery ?? 'pickup',
          events: { create: { status: 'submitted', actorId: auth.userId, actorName: actor ? `${actor.firstName} ${actor.lastName}` : null } },
        },
        include: INCLUDE,
      });
    });
    await this.notifications.notify(auth.schoolId, await approverIds(this.prisma, auth.schoolId), {
      eventType: 'document_request',
      title: `New request: ${TYPE_LABEL[request.type]}`,
      body: `${request.requestNo} · ${request.student.firstName} ${request.student.lastName}`,
      link: '/documents?tab=requests',
    });
    return request;
  }

  /** The signed-in parent's / student's own requests. */
  mine(auth: SchoolAuth) {
    return this.prisma.forSchool(auth.schoolId).documentRequest.findMany({ where: { requestedBy: auth.userId }, include: INCLUDE, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  async cancel(auth: SchoolAuth, id: string) {
    return this.prisma.inSchoolTransaction(auth.schoolId, async (tx) => {
      const r = await tx.documentRequest.findUnique({ where: { id } });
      if (!r || r.requestedBy !== auth.userId) throw new NotFoundException('Request not found');
      if (r.status !== 'submitted') throw new BadRequestException('Only a request that has not been picked up yet can be cancelled');
      return tx.documentRequest.update({
        where: { id },
        data: { status: 'cancelled', events: { create: { status: 'cancelled', actorId: auth.userId, note: 'Cancelled by the requester' } } },
        include: INCLUDE,
      });
    });
  }

  async list(schoolId: string, q: ListRequestsQuery) {
    const where: Prisma.DocumentRequestWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.type && { type: q.type }),
      ...(q.q && {
        OR: [
          { requestNo: { contains: q.q, mode: 'insensitive' } },
          { student: { firstName: { contains: q.q, mode: 'insensitive' } } },
          { student: { lastName: { contains: q.q, mode: 'insensitive' } } },
          { student: { admissionNo: { contains: q.q, mode: 'insensitive' } } },
        ],
      }),
    };
    const db = this.prisma.forSchool(schoolId);
    const [items, total] = await Promise.all([
      db.documentRequest.findMany({ where, include: INCLUDE, orderBy: [{ createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      db.documentRequest.count({ where }),
    ]);
    // Who asked (parent/student name), for the admin list.
    const users = await db.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.requestedBy))] } }, select: { id: true, firstName: true, lastName: true, email: true, phone: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    return { items: items.map((i) => ({ ...i, requester: byId.get(i.requestedBy) ?? null })), total, page: q.page, pageSize: q.pageSize };
  }

  async summary(schoolId: string) {
    const rows = await this.prisma.forSchool(schoolId).documentRequest.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }

  async move(auth: SchoolAuth, id: string, dto: MoveRequestDto) {
    const updated = await this.prisma.inSchoolTransaction(auth.schoolId, async (tx) => {
      const r = await tx.documentRequest.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Request not found');
      if (!ADMIN_TRANSITIONS[r.status].includes(dto.status)) throw new BadRequestException(`A request that is "${r.status.replace('_', ' ')}" cannot move to "${dto.status.replace('_', ' ')}"`);
      if (dto.status === 'rejected' && !dto.note) throw new BadRequestException('Give a reason for declining the request');
      if (dto.documentId) {
        const doc = await tx.document.findUnique({ where: { id: dto.documentId }, select: { ownerType: true, ownerId: true } });
        if (!doc || doc.ownerType !== 'student' || doc.ownerId !== r.studentId) throw new BadRequestException('The attached file must be one of this student’s documents');
      }
      const actor = await tx.user.findUnique({ where: { id: auth.userId }, select: { firstName: true, lastName: true } });
      const now = new Date();
      return tx.documentRequest.update({
        where: { id },
        data: {
          status: dto.status,
          processedBy: auth.userId,
          ...(dto.note !== undefined && dto.note !== null && { adminNote: dto.note }),
          ...(dto.documentId !== undefined && { documentId: dto.documentId }),
          ...(dto.status === 'ready' && { readyAt: now }),
          ...(dto.status === 'completed' && { completedAt: now }),
          events: { create: { status: dto.status, note: dto.note ?? null, actorId: auth.userId, actorName: actor ? `${actor.firstName} ${actor.lastName}` : null } },
        },
        include: INCLUDE,
      });
    });
    await this.notifications.notify(auth.schoolId, [updated.requestedBy], {
      eventType: 'document_request',
      title: `${TYPE_LABEL[updated.type]} ${STATUS_TEXT[updated.status] ?? 'was updated'}`,
      body: dto.note ?? `${updated.requestNo} · ${updated.student.firstName} ${updated.student.lastName}`,
      link: '/document-requests',
    });
    return updated;
  }

  /** A parent may request for their linked children, a student for themselves. */
  private async assertRequester(auth: SchoolAuth, studentId: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const student = await db.student.findUnique({ where: { id: studentId }, select: { userId: true, status: true } });
    if (!student) throw new NotFoundException('Student not found');
    const isSelf = student.userId === auth.userId;
    const isParent = !isSelf && (await db.studentGuardian.count({ where: { studentId, guardian: { userId: auth.userId } } })) > 0;
    if (!isSelf && !isParent) throw new ForbiddenException('You can only request documents for yourself or your own children');
  }
}
