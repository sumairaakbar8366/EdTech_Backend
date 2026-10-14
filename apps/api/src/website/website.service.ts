import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { AdmissionsService } from '../admissions/admissions.service.js';
import { ApplicationDto } from '../admissions/admissions.dto.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { detectAllowedType, safeFileName } from '../documents/file-type.js';
import { ApplicationDetailsDto } from '../hiring/hiring.dto.js';
import { HiringService } from '../hiring/hiring.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { SubscriptionStateService } from '../billing/subscription-state.service.js';

const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class WebsiteDto {
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(160) tagline?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(4000) about?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(120) principalName?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(3000) principalMessage?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(600) mapUrl?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(300) facebookUrl?: string | null;
  @IsOptional() @IsBoolean() admissionsOpen?: boolean;
  @IsOptional() @IsBoolean() careersOpen?: boolean;
  @IsOptional() @IsUUID() heroMediaId?: string | null;
}

export const MEDIA_CATEGORIES = ['campus', 'students', 'events', 'achievements'] as const;

/** Public admission form: the normal application, plus a hidden field bots fill in. */
export class PublicAdmissionDto extends ApplicationDto {
  @IsOptional() @IsString() @MaxLength(0, { message: 'Invalid submission' }) website?: string;
}
export class PublicCareerDto extends ApplicationDetailsDto {
  @IsOptional() @IsString() @MaxLength(0, { message: 'Invalid submission' }) website?: string;
}
export class MediaUploadDto {
  @IsIn(MEDIA_CATEGORIES) category: (typeof MEDIA_CATEGORIES)[number];
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(160) caption?: string | null;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png'] as const;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * The school's public website at <slug>.<platform domain>: generated from what the school already
 * has in the system (classes, campuses, staff, open jobs) plus texts and photos the admin adds.
 * Visitors can apply for admission and for open jobs; both land in the normal queues.
 */
@Injectable()
export class WebsiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly admissions: AdmissionsService,
    private readonly hiring: HiringService,
    private readonly notifications: NotificationsService,
    private readonly plan: SubscriptionStateService,
  ) {}

  // --- Admin ---------------------------------------------------------------------------

  async get(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [website, media] = await Promise.all([
      db.schoolWebsite.findUnique({ where: { schoolId } }),
      db.websiteMedia.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, category: true, caption: true, fileName: true, createdAt: true } }),
    ]);
    return { website: website ?? { schoolId, published: true, admissionsOpen: true, careersOpen: true }, media };
  }

  update(schoolId: string, dto: WebsiteDto) {
    return this.prisma.forSchool(schoolId).schoolWebsite.upsert({ where: { schoolId }, create: { schoolId, ...dto }, update: dto });
  }

  async upload(schoolId: string, userId: string, dto: MediaUploadDto, file: Express.Multer.File) {
    if (file.size === 0) throw new BadRequestException('The file is empty');
    if (file.size > MAX_IMAGE_BYTES) throw new PayloadTooLargeException('Photos must be at most 8 MB');
    const mimeType = detectAllowedType(file.originalname, file.buffer, IMAGE_TYPES);
    if (!mimeType) throw new BadRequestException('Only JPG and PNG photos are allowed');
    const db = this.prisma.forSchool(schoolId);
    if ((await db.websiteMedia.count()) >= 200) throw new BadRequestException('The gallery holds up to 200 photos; remove some first');
    // Same key shape as every other upload: StorageService accepts only "<schoolId>/<uuid>".
    const storageKey = `${schoolId}/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer);
    try {
      return await db.websiteMedia.create({
        data: { schoolId, category: dto.category, caption: dto.caption ?? null, fileName: safeFileName(file.originalname), mimeType, sizeBytes: file.size, storageKey, uploadedBy: userId },
        select: { id: true, category: true, caption: true, fileName: true, createdAt: true },
      });
    } catch (e) {
      await this.storage.delete(storageKey);
      throw e;
    }
  }

  async removeMedia(schoolId: string, id: string) {
    const db = this.prisma.forSchool(schoolId);
    const m = await db.websiteMedia.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Photo not found');
    await db.websiteMedia.delete({ where: { id } });
    await db.schoolWebsite.updateMany({ where: { heroMediaId: id }, data: { heroMediaId: null } });
    await this.storage.delete(m.storageKey);
  }

  // --- Public ----------------------------------------------------------------------------

  /** Everything the public site shows, generated from the school's own data. */
  async site(schoolId: string) {
    const state = await this.plan.get(schoolId);
    const theme = state.features.includes('theme');
    // Richer website imagery on the higher plans; the plan itself is not published.
    const siteTier = !state.locked && ['scale', 'enterprise'].includes(state.tier?.code ?? '') ? 'premium' : 'standard';
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const today = new Date(new Date().toISOString().slice(0, 10));
      const [school, settings, website, campuses, classes, years, students, teachers, jobs, media] = await Promise.all([
        tx.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, slug: true } }),
        tx.schoolSettings.findUnique({ where: { schoolId }, select: { logoUrl: true, primaryColor: true } }),
        tx.schoolWebsite.findUnique({ where: { schoolId } }),
        tx.campus.findMany({ where: { isActive: true }, select: { id: true, name: true, address: true }, orderBy: { name: 'asc' } }),
        tx.schoolClass.findMany({ select: { id: true, name: true, level: true }, orderBy: { level: 'asc' } }),
        tx.academicYear.findMany({ where: { endDate: { gte: today } }, select: { id: true, name: true, isCurrent: true }, orderBy: { startDate: 'asc' } }),
        tx.student.count({ where: { status: 'active' } }),
        tx.employee.count({ where: { status: { in: ['active', 'on_leave'] }, staffType: 'teaching' } }),
        tx.jobPost.findMany({
          where: { status: 'open', OR: [{ closingDate: null }, { closingDate: { gte: today } }] },
          select: { id: true, title: true, staffType: true, department: true, description: true, openings: true, closingDate: true, campus: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
        }),
        tx.websiteMedia.findMany({ select: { id: true, category: true, caption: true }, orderBy: { createdAt: 'desc' }, take: 60 }),
      ]);
      const w = website ?? null;
      const first = classes[0]?.name;
      const last = classes[classes.length - 1]?.name;
      const generatedAbout = `${school.name} is a ${campuses.length > 1 ? `${campuses.length}-campus ` : ''}school offering ${first && last && first !== last ? `classes from ${first} to ${last}` : 'primary and secondary education'}, with ${teachers} dedicated teachers and ${students} students. We focus on strong academics, good character and close partnership with parents.`;
      return {
        school: { name: school.name, slug: school.slug, logoUrl: settings?.logoUrl ?? null, primaryColor: theme ? settings?.primaryColor ?? null : null, siteTier },
        published: w?.published ?? true,
        tagline: w?.tagline ?? 'Learning today, leading tomorrow',
        about: w?.about ?? generatedAbout,
        principalName: w?.principalName ?? null,
        principalMessage: w?.principalMessage ?? null,
        contact: { phone: w?.phone ?? null, email: w?.email ?? null, address: w?.address ?? campuses[0]?.address ?? null, mapUrl: w?.mapUrl ?? null, facebookUrl: w?.facebookUrl ?? null },
        admissionsOpen: w?.admissionsOpen ?? true,
        careersOpen: w?.careersOpen ?? true,
        heroMediaId: w?.heroMediaId ?? media.find((m) => m.category === 'campus')?.id ?? media[0]?.id ?? null,
        stats: { students, teachers, classes: classes.length, campuses: campuses.length },
        campuses,
        classes: classes.map((c) => ({ id: c.id, name: c.name })),
        sessions: years.map((y) => ({ id: y.id, name: y.name, isCurrent: y.isCurrent })),
        jobs: w?.careersOpen === false ? [] : jobs,
        media,
      };
    });
  }

  async openMedia(schoolId: string, id: string) {
    const m = await this.prisma.forSchool(schoolId).websiteMedia.findUnique({ where: { id }, select: { storageKey: true, mimeType: true } });
    if (!m) throw new NotFoundException('Photo not found');
    return { mimeType: m.mimeType, stream: this.storage.read(m.storageKey) };
  }

  async applyForAdmission(schoolId: string, dto: PublicAdmissionDto) {
    const w = await this.prisma.forSchool(schoolId).schoolWebsite.findUnique({ where: { schoolId }, select: { admissionsOpen: true, published: true } });
    if (w && (!w.admissionsOpen || !w.published)) throw new BadRequestException('Online admissions are closed at the moment; please contact the school office');
    const { website: _honeypot, ...application } = dto;
    const app = await this.admissions.create(schoolId, application, null, 'website');
    await this.notifyAdmins(schoolId, 'admission_application', `New admission application · ${app.firstName} ${app.lastName}`, `${app.applicationNo} · received on the school website`, `/admissions/${app.id}`);
    return { applicationNo: app.applicationNo };
  }

  async applyForJob(schoolId: string, postId: string, dto: PublicCareerDto) {
    const w = await this.prisma.forSchool(schoolId).schoolWebsite.findUnique({ where: { schoolId }, select: { careersOpen: true, published: true } });
    if (w && (!w.careersOpen || !w.published)) throw new BadRequestException('Online job applications are closed at the moment');
    const { website: _honeypot, ...details } = dto;
    const app = await this.hiring.addApplication(schoolId, postId, details, 'website');
    const post = await this.prisma.forSchool(schoolId).jobPost.findUnique({ where: { id: postId }, select: { title: true } });
    await this.notifyAdmins(schoolId, 'job_application', `New job application · ${app.firstName} ${app.lastName}`, `${post?.title ?? 'Vacancy'} · received on the school website`, '/staff/hiring');
    return { received: true };
  }

  private async notifyAdmins(schoolId: string, eventType: string, title: string, body: string, link: string) {
    const admins = await this.prisma.forSchool(schoolId).user.findMany({ where: { status: 'active', userRoles: { some: { role: { key: 'school_admin' } } } }, select: { id: true } });
    await this.notifications.notify(schoolId, admins.map((a) => a.id), { eventType, title, body, link });
  }
}
