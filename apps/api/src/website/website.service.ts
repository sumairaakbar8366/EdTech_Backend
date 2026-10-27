import { BadRequestException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsObject, IsOptional, IsString, IsUrl, IsUUID, MaxLength } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { AdmissionsService } from '../admissions/admissions.service.js';
import { ApplicationDto } from '../admissions/admissions.dto.js';
import { checkApplication, cleanAdmissionForm, fieldsForClass, readAdmissionForm, throwFieldErrors, type AdmissionFormDto, type FormAnswer } from '../admissions/admission-form.js';
import type { Prisma } from '../generated/prisma/client.js';
import { RedisService } from '../redis/redis.service.js';
import { toDateOnly } from '../common/date-only.js';
import { NotificationsService } from '../communication/notifications.service.js';
import { DOCUMENT_TYPES, detectAllowedType, safeFileName } from '../documents/file-type.js';
import { ApplicationDetailsDto } from '../hiring/hiring.dto.js';
import { HiringService } from '../hiring/hiring.service.js';
import { socialLinks, SocialLinksDto } from '../common/social-links.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { SubscriptionStateService } from '../billing/subscription-state.service.js';

const trimOrNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class WebsiteDto extends SocialLinksDto {
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(160) tagline?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(4000) about?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(120) principalName?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(3000) principalMessage?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(300) address?: string | null;
  @IsOptional() @Transform(trimOrNull) @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(600) mapUrl?: string | null;
  @IsOptional() @IsBoolean() admissionsOpen?: boolean;
  @IsOptional() @IsBoolean() careersOpen?: boolean;
  @IsOptional() @IsUUID() heroMediaId?: string | null;
  @IsOptional() @IsBoolean() feesPublic?: boolean;
  @IsOptional() @Transform(trimOrNull) @IsString() @MaxLength(2000) feeNote?: string | null;
}

export const MEDIA_CATEGORIES = ['campus', 'students', 'events', 'achievements'] as const;

/**
 * Public admission form: the standard application, the answers to the school's own fields
 * (by field id; checked against its form) and a hidden field bots fill in.
 */
export class PublicAdmissionDto extends ApplicationDto {
  @IsOptional() @IsObject() answers?: Record<string, unknown>;
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
const FREQUENCY_ORDER = ['one_time', 'monthly', 'termly', 'annual'];
const digits = (phone: string) => phone.replace(/\D/g, '').slice(-10);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Documents attached on the admission form (B-Form, result card, ...). */
export const MAX_APPLICATION_FILE_BYTES = 5 * 1024 * 1024;
/** An uploaded document waits this long for its application to be sent. */
const STAGED_FILE_TTL_SECONDS = 6 * 3600;
const stagedFileKey = (schoolId: string, id: string) => `schoolerp:admission-file:${schoolId}:${id}`;
interface StagedFile { fileName: string; mimeType: string; sizeBytes: number }

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
    private readonly redis: RedisService,
  ) {}

  // --- Admin ---------------------------------------------------------------------------

  async get(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [website, media] = await Promise.all([
      db.schoolWebsite.findUnique({ where: { schoolId } }),
      db.websiteMedia.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, category: true, caption: true, fileName: true, createdAt: true } }),
    ]);
    return { website: website ?? { schoolId, published: true, admissionsOpen: true, careersOpen: true, feesPublic: false }, media };
  }

  update(schoolId: string, dto: WebsiteDto) {
    return this.prisma.forSchool(schoolId).schoolWebsite.upsert({ where: { schoolId }, create: { schoolId, ...dto }, update: dto });
  }

  /** The school's admission form, with its classes for the class filter. */
  async admissionForm(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [w, classes] = await Promise.all([
      db.schoolWebsite.findUnique({ where: { schoolId }, select: { admissionForm: true } }),
      db.schoolClass.findMany({ select: { id: true, name: true }, orderBy: { level: 'asc' } }),
    ]);
    return { form: readAdmissionForm(w?.admissionForm), classes };
  }

  async saveAdmissionForm(schoolId: string, dto: AdmissionFormDto) {
    const db = this.prisma.forSchool(schoolId);
    const classes = await db.schoolClass.findMany({ select: { id: true } });
    const form = cleanAdmissionForm(dto, classes.map((c) => c.id));
    const json = form as unknown as Prisma.InputJsonValue;
    await db.schoolWebsite.upsert({ where: { schoolId }, create: { schoolId, admissionForm: json }, update: { admissionForm: json } });
    return form;
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
        tx.schoolSettings.findUnique({ where: { schoolId }, select: { logoUrl: true, primaryColor: true, currency: true } }),
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
      // Fees of the sessions still open (current and upcoming), only when the school publishes them.
      const fees = website?.feesPublic
        ? await tx.feeStructure.findMany({
            where: { isActive: true, academicYearId: { in: years.map((y) => y.id) } },
            select: { id: true, name: true, academicYearId: true, classId: true, items: { select: { amount: true, frequency: true, category: { select: { name: true } } } } },
            orderBy: [{ schoolClass: { level: 'asc' } }, { name: 'asc' }],
          })
        : [];
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
        contact: { phone: w?.phone ?? null, email: w?.email ?? null, address: w?.address ?? campuses[0]?.address ?? null, mapUrl: w?.mapUrl ?? null, ...socialLinks(w) },
        admissionsOpen: w?.admissionsOpen ?? true,
        careersOpen: w?.careersOpen ?? true,
        heroMediaId: w?.heroMediaId ?? media.find((m) => m.category === 'campus')?.id ?? media[0]?.id ?? null,
        stats: { students, teachers, classes: classes.length, campuses: campuses.length },
        campuses,
        classes: classes.map((c) => ({ id: c.id, name: c.name })),
        sessions: years.map((y) => ({ id: y.id, name: y.name, isCurrent: y.isCurrent })),
        jobs: w?.careersOpen === false ? [] : jobs,
        media,
        admissionForm: readAdmissionForm(w?.admissionForm),
        fees: w?.feesPublic
          ? {
              currency: settings?.currency ?? 'USD',
              note: w.feeNote ?? null,
              structures: fees.map((f) => ({
                id: f.id,
                name: f.name,
                sessionId: f.academicYearId,
                classId: f.classId,
                items: f.items
                  .map((i) => ({ name: i.category.name, amount: i.amount.toFixed(2), frequency: i.frequency }))
                  .sort((a, b) => FREQUENCY_ORDER.indexOf(a.frequency) - FREQUENCY_ORDER.indexOf(b.frequency) || a.name.localeCompare(b.name)),
              })),
            }
          : null,
      };
    });
  }

  async openMedia(schoolId: string, id: string) {
    const m = await this.prisma.forSchool(schoolId).websiteMedia.findUnique({ where: { id }, select: { storageKey: true, mimeType: true } });
    if (!m) throw new NotFoundException('Photo not found');
    return { mimeType: m.mimeType, stream: this.storage.read(m.storageKey) };
  }

  /** A document chosen on the admission form, uploaded before the form is sent; the application claims it. */
  async stageApplicationFile(schoolId: string, file: Express.Multer.File) {
    if (file.size === 0) throw new BadRequestException('The file is empty');
    if (file.size > MAX_APPLICATION_FILE_BYTES) throw new PayloadTooLargeException('Documents must be at most 5 MB');
    const mimeType = detectAllowedType(file.originalname, file.buffer, DOCUMENT_TYPES);
    if (!mimeType) throw new BadRequestException('Only PDF, Word (.docx), JPG and PNG files are allowed');
    const fileId = randomUUID();
    const fileName = safeFileName(file.originalname);
    await this.storage.put(`${schoolId}/${fileId}`, file.buffer);
    const staged: StagedFile = { fileName, mimeType, sizeBytes: file.size };
    await this.redis.set(stagedFileKey(schoolId, fileId), JSON.stringify(staged), 'EX', STAGED_FILE_TTL_SECONDS);
    return { fileId, fileName };
  }

  /**
   * An application from the website, checked field by field against the school's own form. Every
   * problem is reported at once (by field), so the applicant can fix them all in one go.
   */
  async applyForAdmission(schoolId: string, dto: PublicAdmissionDto) {
    const w = await this.prisma.forSchool(schoolId).schoolWebsite.findUnique({ where: { schoolId }, select: { admissionsOpen: true, published: true, admissionForm: true } });
    if (w && (!w.admissionsOpen || !w.published)) throw new BadRequestException('Online admissions are closed at the moment; please contact the school office');
    const { website: _honeypot, answers: rawAnswers, ...application } = dto;
    // One application per child (checked first, so a parent applying again is told at once): the same name, date of birth and parent's phone is the same child.
    const sameChild = await this.prisma.forSchool(schoolId).admissionApplication.findMany({
      where: {
        firstName: { equals: application.firstName, mode: 'insensitive' },
        lastName: { equals: application.lastName, mode: 'insensitive' },
        dateOfBirth: toDateOnly(application.dateOfBirth),
        status: { notIn: ['rejected', 'withdrawn'] },
      },
      select: { applicationNo: true, status: true, guardianPhone: true },
    });
    const dup = sameChild.find((a) => digits(a.guardianPhone) === digits(application.guardianPhone));
    if (dup) {
      throw new BadRequestException(
        dup.status === 'enrolled'
          ? `${application.firstName} ${application.lastName} is already enrolled at the school (application ${dup.applicationNo}).`
          : `An application for ${application.firstName} ${application.lastName} is already in progress (${dup.applicationNo}). The school office will contact you; there is no need to apply again.`,
      );
    }

    const form = readAdmissionForm(w?.admissionForm);
    const checked = checkApplication(form, application.classId, application, rawAnswers);
    // Fields the school does not ask are not stored, whatever was sent.
    for (const key of checked.hidden) {
      if (key === 'photoId') delete application.photoId;
      else if (key === 'gender') application.gender = null;
      else application[key] = null;
    }

    const files = await Promise.all(
      checked.files.map(async (f) => {
        const raw = await this.redis.get(stagedFileKey(schoolId, f.fileId));
        if (!raw) checked.errors[f.fieldId] = 'The upload has expired; please attach the document again';
        return { ...f, staged: raw ? (JSON.parse(raw) as StagedFile) : null, documentId: randomUUID() };
      }),
    );
    throwFieldErrors(checked.errors);

    // Answers in the order of the form, with each document linked to its stored copy.
    const byField = new Map<string, FormAnswer>(checked.answers.map((a) => [a.fieldId, a]));
    for (const f of files) byField.set(f.fieldId, { fieldId: f.fieldId, label: f.label, type: 'file', section: 'documents', saveTo: null, value: { documentId: f.documentId, fileName: f.staged!.fileName } });
    const formAnswers = fieldsForClass(form, application.classId).flatMap((f) => byField.get(f.id) ?? []);
    const documents = files.map((f) => ({ id: f.documentId, category: 'other', title: f.label.slice(0, 150), fileName: f.staged!.fileName, mimeType: f.staged!.mimeType, sizeBytes: f.staged!.sizeBytes, storageKey: `${schoolId}/${f.fileId}` }));

    const app = await this.admissions.create(schoolId, application, null, 'website', { formAnswers, documents });
    if (files.length) await this.redis.del(...files.map((f) => stagedFileKey(schoolId, f.fileId)));
    await this.notifyAdmins(schoolId, 'admission_application', `New admission application · ${app.firstName} ${app.lastName}`, `${app.applicationNo} · received on the school website`, `/admissions/${app.id}`);
    return { applicationNo: app.applicationNo };
  }

  async applyForJob(schoolId: string, postId: string, dto: PublicCareerDto) {
    const w = await this.prisma.forSchool(schoolId).schoolWebsite.findUnique({ where: { schoolId }, select: { careersOpen: true, published: true } });
    if (w && (!w.careersOpen || !w.published)) throw new BadRequestException('Online job applications are closed at the moment');
    const { website: _honeypot, ...details } = dto;
    if (!details.photoId) throw new BadRequestException('Please add your photo');
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
