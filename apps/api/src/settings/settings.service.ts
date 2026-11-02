import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { DeliveryService } from '../delivery/delivery.service.js';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { resolveCname, resolveTxt } from 'node:dns/promises';
import type { Env } from '../config/env.js';
import { detectAllowedType } from '../documents/file-type.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { TenantResolverService } from '../tenancy/tenant-resolver.service.js';
import type { SchoolSettingsDto } from './settings.dto.js';

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_PATH = '/api/tenant/logo/';
/** TXT record a school publishes to prove it controls a custom domain. */
export const verifyRecordName = (hostname: string) => `_schoolerp-verify.${hostname}`;

/** School configuration: regional settings, branding (colours, logo) and custom domains (MVP list page 17). */
@Injectable()
export class SettingsService {
  private readonly baseDomain: string;
  private readonly platformHost: string;

  /** Email is always on; mobile messages go by the channel the admin chose, if the platform has it set up. */
  async notificationChannels(schoolId: string) {
    const s = await this.prisma.forSchool(schoolId).schoolSettings.findUnique({ where: { schoolId }, select: { mobileChannel: true } });
    const providers = this.delivery.channelProviders();
    return { email: true, mobileChannel: (s?.mobileChannel ?? 'off') as 'off' | 'sms' | 'whatsapp', providers, live: { email: providers.email !== 'outbox', sms: providers.sms !== 'outbox', whatsapp: providers.whatsapp !== 'outbox', push: providers.push !== 'outbox' } };
  }

  async setMobileChannel(schoolId: string, mobileChannel: 'off' | 'sms' | 'whatsapp') {
    await this.prisma.forSchool(schoolId).schoolSettings.update({ where: { schoolId }, data: { mobileChannel } });
    return this.notificationChannels(schoolId);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly resolver: TenantResolverService,
    private readonly delivery: DeliveryService,
    config: ConfigService<Env, true>,
  ) {
    this.baseDomain = config.get('BASE_DOMAIN', { infer: true }).toLowerCase();
    this.platformHost = config.get('PLATFORM_HOST', { infer: true }).toLowerCase();
  }

  async get(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [school, settings, domains] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, slug: true } }),
      db.schoolSettings.findUnique({ where: { schoolId } }),
      this.prisma.domain.findMany({ where: { schoolId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      // Schools live at /<slug> on the main domain; an own (paid) domain points its CNAME at the main domain.
      school: { ...school, address: `${this.baseDomain}/${school.slug}` },
      settings,
      domains: domains.map((d) => ({ ...d, txtName: verifyRecordName(d.hostname), txtValue: d.id, cnameTarget: this.baseDomain })),
    };
  }

  async update(schoolId: string, dto: SchoolSettingsDto) {
    const db = this.prisma.forSchool(schoolId);
    const data = {
      ...(dto.timezone !== undefined && { timezone: dto.timezone }),
      ...(dto.currency !== undefined && { currency: dto.currency.toUpperCase() }),
      ...(dto.locale !== undefined && { locale: dto.locale }),
      ...(dto.primaryColor !== undefined && { primaryColor: dto.primaryColor }),
      ...(dto.secondaryColor !== undefined && { secondaryColor: dto.secondaryColor }),
      ...(dto.weeklyOffDays !== undefined && { weeklyOffDays: [...new Set(dto.weeklyOffDays)].sort() }),
    };
    return db.schoolSettings.upsert({ where: { schoolId }, create: { schoolId, ...data }, update: data });
  }

  // --- Logo ---------------------------------------------------------------------------

  async setLogo(schoolId: string, file: Express.Multer.File) {
    if (file.size > LOGO_MAX_BYTES) throw new PayloadTooLargeException('The logo must be at most 2 MB');
    const mime = detectAllowedType(file.originalname, file.buffer, ['image/png', 'image/jpeg']);
    if (!mime) throw new BadRequestException('The logo must be a PNG or JPG image');
    const id = randomUUID();
    await this.storage.put(`${schoolId}/${id}`, file.buffer);
    const db = this.prisma.forSchool(schoolId);
    const previous = (await db.schoolSettings.findUnique({ where: { schoolId }, select: { logoUrl: true } }))?.logoUrl;
    const logoUrl = `${LOGO_PATH}${id}`;
    await db.schoolSettings.upsert({ where: { schoolId }, create: { schoolId, logoUrl }, update: { logoUrl } });
    if (previous?.startsWith(LOGO_PATH)) await this.storage.delete(`${schoolId}/${previous.slice(LOGO_PATH.length)}`);
    return { logoUrl };
  }

  async removeLogo(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const previous = (await db.schoolSettings.findUnique({ where: { schoolId }, select: { logoUrl: true } }))?.logoUrl;
    await db.schoolSettings.updateMany({ where: { schoolId }, data: { logoUrl: null } });
    if (previous?.startsWith(LOGO_PATH)) await this.storage.delete(`${schoolId}/${previous.slice(LOGO_PATH.length)}`);
    return { ok: true };
  }

  /** Streams the current logo, only when `id` is the school's current logo. */
  async openLogo(schoolId: string, id: string) {
    const current = (await this.prisma.forSchool(schoolId).schoolSettings.findUnique({ where: { schoolId }, select: { logoUrl: true } }))?.logoUrl;
    if (current !== `${LOGO_PATH}${id}`) throw new NotFoundException('Logo not found');
    return this.storage.read(`${schoolId}/${id}`);
  }

  // --- Custom domains ---------------------------------------------------------------------

  async addDomain(schoolId: string, raw: string) {
    const hostname = raw.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) throw new BadRequestException('Enter a domain such as portal.yourschool.edu');
    if (hostname === this.baseDomain || hostname.endsWith(`.${this.baseDomain}`) || hostname === this.platformHost) {
      throw new BadRequestException('That address is part of Skool EdTech; add your school’s own domain instead');
    }
    if (await this.prisma.domain.findUnique({ where: { hostname } })) throw new ConflictException('This domain is already registered');
    const count = await this.prisma.domain.count({ where: { schoolId } });
    if (count >= 5) throw new BadRequestException('A school can register up to 5 domains');
    return this.prisma.domain.create({ data: { schoolId, hostname, isPrimary: false } });
  }

  /**
   * Verifies a domain: the TXT record `_schoolerp-verify.<domain>` must contain the domain id, or
   * the domain must be a CNAME of the main domain. Verified domains start resolving at once.
   */
  async verifyDomain(schoolId: string, id: string) {
    const domain = await this.prisma.domain.findFirst({ where: { id, schoolId } });
    if (!domain) throw new NotFoundException('Domain not found');
    if (domain.verifiedAt) return domain;
    const target = this.baseDomain;
    const [txt, cname] = await Promise.all([
      resolveTxt(verifyRecordName(domain.hostname)).then((r) => r.map((parts) => parts.join(''))).catch(() => [] as string[]),
      resolveCname(domain.hostname).catch(() => [] as string[]),
    ]);
    const ok = txt.includes(domain.id) || cname.some((c) => c.toLowerCase().replace(/\.$/, '') === target);
    if (!ok) throw new BadRequestException(`DNS not found yet. Add a TXT record ${verifyRecordName(domain.hostname)} = ${domain.id}, or a CNAME to ${target}. DNS changes can take up to an hour.`);
    const verified = await this.prisma.domain.update({ where: { id }, data: { verifiedAt: new Date() } });
    this.resolver.invalidate();
    return verified;
  }

  async makePrimary(schoolId: string, id: string) {
    const domain = await this.prisma.domain.findFirst({ where: { id, schoolId } });
    if (!domain) throw new NotFoundException('Domain not found');
    if (!domain.verifiedAt) throw new BadRequestException('Verify the domain first');
    await this.prisma.$transaction([
      this.prisma.domain.updateMany({ where: { schoolId, isPrimary: true }, data: { isPrimary: false } }),
      this.prisma.domain.update({ where: { id }, data: { isPrimary: true } }),
    ]);
    return { ok: true };
  }

  async removeDomain(schoolId: string, id: string) {
    const r = await this.prisma.domain.deleteMany({ where: { id, schoolId } });
    if (!r.count) throw new NotFoundException('Domain not found');
    this.resolver.invalidate();
    return { ok: true };
  }
}
