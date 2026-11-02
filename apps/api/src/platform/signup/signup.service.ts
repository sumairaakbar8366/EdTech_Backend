import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { isValidSchoolSlug } from '@schoolerp/shared';
import type { Env } from '../../config/env.js';
import { SocialIdentityService } from '../../auth/social-identity.service.js';
import { LoginTicketService } from '../../auth/login-ticket.service.js';
import { DeliveryService } from '../../delivery/delivery.service.js';
import { OwnerAlertsService } from '../../delivery/owner-alerts.service.js';
import { WebUrls } from '../../delivery/web-urls.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SchoolProvisioningService } from '../schools/school-provisioning.service.js';

/** Plan a new school is attached to during its trial (the trial itself has every feature). */
const TRIAL_TIER_ORDER = ['growth', 'starter'];

/** "Greenfield High School, Lahore" → "greenfield-high-school-lahore" (same rule as the web form). */
const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** A strong, readable password for emailing (no look-alike characters), with letters and digits. */
function generatePassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)]!, digits[randomInt(digits.length)]!, ...Array.from({ length: 14 }, () => all[randomInt(all.length)]!)];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/** Everything needed to create a verified school and its first admin. */
export interface NewSchool {
  schoolName: string;
  city: string;
  firstName: string;
  lastName: string;
  designation: string;
  email: string;
  phone: string;
  trialDays: number;
  /** How the owner's mailbox was proven. */
  method: 'google' | 'email';
  /** One line for the owner's alert about who registered and how big the school is. */
  summary: string;
}

/**
 * Creates a school once the registration checks have passed (see RegistrationService): the school,
 * its first admin (password emailed, never shown), a trial sized to the school, the owner's record
 * under Applications, and the owner's alert. Nothing else creates schools by itself.
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: SchoolProvisioningService,
    private readonly tickets: LoginTicketService,
    private readonly delivery: DeliveryService,
    private readonly urls: WebUrls,
    private readonly social: SocialIdentityService,
    private readonly alerts: OwnerAlertsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** What the registration and sign-in screens may offer (public, no secrets). */
  publicConfig() {
    return { googleClientId: this.social.clientIds.google };
  }

  /** A free web address from the school's name: the name itself, else the first numbered variant. */
  async freeSlug(schoolName: string): Promise<string> {
    const base = slugify(schoolName).replace(/^(.{0,2})$/, '$1-school');
    for (let n = 1; n < 100; n++) {
      const s = n === 1 ? base : `${base.slice(0, 60)}-${n}`;
      if (isValidSchoolSlug(s) && !(await this.prisma.school.findUnique({ where: { slug: s }, select: { id: true } }))) return s;
    }
    throw new ConflictException('Choose a different school name: no free web address could be made from it.');
  }

  async createSchool(dto: NewSchool) {
    const slug = await this.freeSlug(dto.schoolName);
    const tier = await this.trialTier();
    const password = generatePassword();
    const now = new Date();
    const result = await this.provisioning.provision(
      { name: dto.schoolName, slug, tierCode: tier, timezone: 'Asia/Karachi', currency: 'PKR', campus: { name: 'Main Campus', code: 'MAIN' }, admin: { firstName: dto.firstName, lastName: dto.lastName, email: dto.email, password } },
      now,
      // The password travels by email, so it is temporary: the first sign-in must replace it.
      true,
      true,
      dto.trialDays,
    );
    await this.prisma.schoolApplication.create({
      data: { schoolName: dto.schoolName, contactFirstName: dto.firstName, contactLastName: dto.lastName, designation: dto.designation, contactEmail: dto.email, contactPhone: dto.phone, schoolCity: dto.city, requestedTierCode: tier, source: 'verified_registration', status: 'onboarded', reviewedAt: now, schoolId: result.school.id },
    });
    await this.prisma.forSchool(result.school.id).user.update({ where: { id: result.admin.id }, data: { phone: dto.phone } });

    const signInUrl = this.urls.school(slug, '/login');
    const trialEndsAt = result.subscription.trialEndsAt;
    await this.delivery.trySend({
      channel: 'email',
      to: dto.email,
      template: 'school_signup_welcome',
      schoolId: result.school.id,
      data: { name: dto.firstName, schoolName: dto.schoolName, loginId: result.admin.loginId, signInUrl, trialEndsAt: trialEndsAt.toISOString(), password, provider: dto.method === 'google' ? 'Google' : undefined },
    });
    await this.alerts.raise({
      kind: 'school_signup',
      title: `New verified school: ${dto.schoolName}`,
      body: `${dto.firstName} ${dto.lastName} (${dto.email}) passed every check. ${dto.summary} Trial: ${dto.trialDays} days.`,
      link: `/schools/${result.school.id}`,
      schoolId: result.school.id,
      actor: dto.email,
      email: {
        template: 'owner_new_signup',
        data: { schoolName: dto.schoolName, slug, contact: `${dto.firstName} ${dto.lastName} (${dto.designation})`, email: dto.email, phone: dto.phone, city: dto.city, trialEndsAt: trialEndsAt.toISOString(), consoleUrl: this.urls.platform(`/schools/${result.school.id}`), method: `verified registration (${dto.method === 'google' ? 'Google' : 'email code'})` },
      },
    });
    const ticket = await this.tickets.create({ schoolId: result.school.id, userId: result.admin.id, purpose: 'signup' });
    return {
      school: { id: result.school.id, name: dto.schoolName, slug },
      loginId: result.admin.loginId,
      trialEndsAt,
      trialDays: dto.trialDays,
      signInUrl,
      passwordSentTo: dto.email,
      /** Opens the school's site already signed in (valid 2 minutes, once). */
      continueUrl: this.urls.school(slug, `/welcome?ticket=${ticket}`),
    };
  }

  private async trialTier(): Promise<string> {
    const tiers = await this.prisma.subscriptionTier.findMany({ where: { isActive: true }, select: { code: true }, orderBy: { sortOrder: 'asc' } });
    const codes = tiers.map((t) => t.code);
    const pick = TRIAL_TIER_ORDER.find((c) => codes.includes(c)) ?? codes[0];
    if (!pick) throw new ConflictException('Registration is not available right now. Please contact us.');
    return pick;
  }
}
