import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { hasAccess } from '@schoolerp/shared';
import { randomUUID } from 'node:crypto';
import type { AuthContext } from '../common/request-context.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PermissionService } from '../rbac/permission.service.js';
import { StorageService } from '../storage/storage.service.js';
import { detectAllowedType, safeFileName } from './file-type.js';

export type OwnerType = 'student' | 'employee' | 'guardian' | 'admission_application' | 'school' | 'job_application';
type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;

export interface UploadInput {
  ownerType: OwnerType;
  ownerId: string;
  category: string;
  title: string;
  file: { originalname: string; buffer: Buffer; size: number };
}

/**
 * Files attached to records (student B-Forms, staff contracts, admission documents, ...).
 * Who may see a document depends on its owner:
 * - documents:crud / documents:view see everything in the school (admin / accounts)
 * - documents:own sees documents of one's own staff or student record
 * - documents:children lets parents see their children's documents
 * - admission documents follow the admissions permission.
 */
@Injectable()
export class DocumentsService {
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionService,
    config: ConfigService<Env, true>,
  ) {
    this.maxBytes = config.get('MAX_UPLOAD_MB', { infer: true }) * 1024 * 1024;
  }

  async list(auth: SchoolAuth, ownerType: OwnerType, ownerId: string) {
    await this.assertAccess(auth, ownerType, ownerId, 'read');
    return this.prisma.forSchool(auth.schoolId).document.findMany({
      where: { ownerType, ownerId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, category: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
    });
  }

  async upload(auth: SchoolAuth, input: UploadInput) {
    await this.assertAccess(auth, input.ownerType, input.ownerId, 'write');
    if (input.file.size === 0) throw new BadRequestException('The file is empty');
    if (input.file.size > this.maxBytes) throw new PayloadTooLargeException(`Files must be at most ${this.maxBytes / 1024 / 1024} MB`);
    const mimeType = detectAllowedType(input.file.originalname, input.file.buffer);
    if (!mimeType) throw new BadRequestException('Only PDF, Word (.docx), JPG and PNG files are allowed');

    const storageKey = `${auth.schoolId}/${randomUUID()}`;
    await this.storage.put(storageKey, input.file.buffer);
    try {
      return await this.prisma.forSchool(auth.schoolId).document.create({
        data: {
          schoolId: auth.schoolId,
          ownerType: input.ownerType,
          ownerId: input.ownerId,
          category: input.category,
          title: input.title,
          fileName: safeFileName(input.file.originalname),
          mimeType,
          sizeBytes: input.file.size,
          storageKey,
          uploadedBy: auth.userId,
        },
        select: { id: true, category: true, title: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true },
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  async open(auth: SchoolAuth, id: string) {
    const doc = await this.prisma.forSchool(auth.schoolId).document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.assertAccess(auth, doc.ownerType, doc.ownerId, 'read');
    return { doc, stream: this.storage.read(doc.storageKey) };
  }

  async remove(auth: SchoolAuth, id: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const doc = await db.document.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Document not found');
    await this.assertAccess(auth, doc.ownerType, doc.ownerId, 'write');
    await db.document.delete({ where: { id } });
    await this.storage.delete(doc.storageKey);
  }

  /** Throws unless the user may read/write documents of this owner (which must exist). */
  async assertAccess(auth: SchoolAuth, ownerType: OwnerType, ownerId: string, mode: 'read' | 'write'): Promise<void> {
    const db = this.prisma.forSchool(auth.schoolId);
    const { permissions } = await this.permissions.loadUserAccess(auth.schoolId, auth.userId);
    const perms = new Set(permissions);

    if (ownerType === 'admission_application') {
      const app = await db.admissionApplication.findUnique({ where: { id: ownerId }, select: { id: true } });
      if (!app) throw new NotFoundException('Application not found');
      if (hasAccess(perms, 'admissions', mode === 'write' ? ['crud'] : ['crud', 'view'])) return;
      throw new ForbiddenException();
    }

    if (ownerType === 'job_application') {
      const app = await db.jobApplication.findUnique({ where: { id: ownerId }, select: { id: true } });
      if (!app) throw new NotFoundException('Application not found');
      if (hasAccess(perms, 'staff', mode === 'write' ? ['crud'] : ['crud', 'view'])) return;
      throw new ForbiddenException();
    }

    const owner = await this.ownerLink(auth.schoolId, ownerType, ownerId);
    if (!owner) throw new NotFoundException('Record not found');
    if (hasAccess(perms, 'documents', ['crud'])) return;
    if (mode === 'write') throw new ForbiddenException('You do not have permission to change documents');
    if (hasAccess(perms, 'documents', ['view'])) return;
    if (hasAccess(perms, 'documents', ['own']) && owner.userIds.includes(auth.userId)) return;
    if (hasAccess(perms, 'documents', ['children']) && owner.guardianUserIds.includes(auth.userId)) return;
    throw new ForbiddenException();
  }

  /** The login(s) that "own" a record, and (for students) their guardians' logins. */
  private async ownerLink(schoolId: string, ownerType: OwnerType, ownerId: string): Promise<{ userIds: string[]; guardianUserIds: string[] } | null> {
    const db = this.prisma.forSchool(schoolId);
    switch (ownerType) {
      case 'student': {
        const s = await db.student.findUnique({
          where: { id: ownerId },
          select: { userId: true, guardians: { select: { guardian: { select: { userId: true } } } } },
        });
        return s && { userIds: s.userId ? [s.userId] : [], guardianUserIds: s.guardians.flatMap((g) => (g.guardian.userId ? [g.guardian.userId] : [])) };
      }
      case 'employee': {
        const e = await db.employee.findUnique({ where: { id: ownerId }, select: { userId: true } });
        return e && { userIds: e.userId ? [e.userId] : [], guardianUserIds: [] };
      }
      case 'guardian': {
        const g = await db.guardian.findUnique({ where: { id: ownerId }, select: { userId: true } });
        return g && { userIds: g.userId ? [g.userId] : [], guardianUserIds: [] };
      }
      case 'school':
        return ownerId === schoolId ? { userIds: [], guardianUserIds: [] } : null;
      default:
        return null;
    }
  }
}
