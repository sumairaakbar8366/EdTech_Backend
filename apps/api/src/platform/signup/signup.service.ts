import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { isValidSchoolSlug } from '@schoolerp/shared';
import type { Env } from '../../config/env.js';
import { SocialIdentityService } from '../../auth/social-identity.service.js';
import { LoginTicketService } from '../../auth/login-ticket.service.js';
import { VerificationCodesService } from '../../auth/verification-codes.service.js';
import { DeliveryService } from '../../delivery/delivery.service.js';
import { WebUrls } from '../../delivery/web-urls.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SchoolProvisioningService } from '../schools/school-provisioning.service.js';
import type { QuickSignupDto, SignupDto } from './signup.dto.js';

/** Plan a self-service school is attached to during its trial (the trial itself has every feature). */
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

/** Everything needed to create a self-service school and its first admin. */
interface NewSchool {
  schoolName: string;
  slug: string;
  city: string | null;
  firstName: string;
  lastName: string;
  designation: string;
  email: string;
  phone: string | null;
  password: string;
  /** Sent in the welcome email when the password was generated for them. */
  emailPassword: boolean;
  method: 'form' | 'email' | 'google';
}

/**
 * Self-service sign-up (like any SaaS): the person proves their email with a code, the school is
 * provisioned at once on a free trial, and they continue to their school's site already signed in
 * (one-time ticket). The platform owner sees it under Applications (source "self_signup") and gets an email.
 */
@Injectable()
export class SignupService {
  private readonly log = new Logger(SignupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: SchoolProvisioningService,
    private readonly codes: VerificationCodesService,
    private readonly tickets: LoginTicketService,
    private readonly delivery: DeliveryService,
    private readonly urls: WebUrls,
    private readonly social: SocialIdentityService,
    config: ConfigService<Env, true>,
  ) {
    this.verificationOff = config.get('EMAIL_VERIFICATION', { infer: true }) === 'off';
  }

  /** EMAIL_VERIFICATION=off (testing only): emails are accepted without a code. */
  private readonly verificationOff: boolean;

  /** What the sign-up and sign-in screens may offer (public, no secrets). */
  config() {
    return { googleClientId: this.social.clientIds.google, emailVerification: this.verificationOff ? ('off' as const) : ('required' as const) };
  }

  /** Whether a web address can be taken, with a free alternative when it cannot. */
  async checkSlug(raw: string) {
    const slug = raw.trim().toLowerCase();
    if (!isValidSchoolSlug(slug)) return { slug, available: false, reason: 'Use 3–63 lowercase letters, digits or hyphens (not a reserved word).', suggestion: null };
    if (!(await this.taken(slug))) return { slug, available: true, reason: null, suggestion: null };
    for (let n = 2; n < 50; n++) {
      const s = `${slug.slice(0, 60)}-${n}`;
      if (!(await this.taken(s))) return { slug, available: false, reason: 'This address is taken.', suggestion: s };
    }
    return { slug, available: false, reason: 'This address is taken.', suggestion: null };
  }

  sendCode(email: string) {
    // Testing mode: nothing is sent and no code is asked for.
    if (this.verificationOff) return Promise.resolve({ verificationId: null, email, expiresInSeconds: 0, resendInSeconds: 0, skipped: true as const });
    return this.codes.send({ owner: `signup:${email}`, email, purpose: 'signup' });
  }

  async signup(dto: SignupDto) {
    if (!isValidSchoolSlug(dto.slug)) throw new BadRequestException('This web address is reserved. Choose another.');
    if (await this.taken(dto.slug)) throw new ConflictException('This web address is taken. Choose another.');
    const email = this.verificationOff ? dto.email : await this.codes.verify(dto.verificationId, `signup:${dto.email}`, dto.code);
    return this.create({ schoolName: dto.schoolName, slug: dto.slug, city: dto.city ?? null, firstName: dto.firstName, lastName: dto.lastName, designation: dto.designation, email, phone: dto.phone, password: dto.password, emailPassword: false, method: 'form' });
  }

  /** The "Start free trial" sign-up: a school name plus Google, or an email and name. */
  async quickSignup(dto: QuickSignupDto) {
    let who: { email: string; firstName: string; lastName: string };
    let method: NewSchool['method'];
    if (dto.credential) {
      if (!dto.provider || !dto.nonce) throw new BadRequestException('Continue with Google again.');
      who = await this.social.verify(dto.provider, dto.credential, dto.nonce);
      method = dto.provider;
    } else {
      if (!dto.email) throw new BadRequestException('Enter your email, or continue with Google.');
      if (!this.verificationOff && !(dto.verificationId && dto.code)) throw new BadRequestException('Enter the 6-digit code we emailed you.');
      const email = this.verificationOff ? dto.email : await this.codes.verify(dto.verificationId!, `signup:${dto.email}`, dto.code!);
      const [first, ...rest] = (dto.name ?? '').split(/\s+/).filter(Boolean);
      who = { email, firstName: (first ?? email.split('@')[0] ?? 'School').slice(0, 100), lastName: (rest.join(' ') || 'Admin').slice(0, 100) };
      method = 'email';
    }
    const slug = await this.freeSlug(dto.schoolName);
    return this.create({ schoolName: dto.schoolName, slug, city: null, firstName: who.firstName, lastName: who.lastName, designation: 'Administrator', email: who.email, phone: null, password: generatePassword(), emailPassword: true, method });
  }

  /** A free web address from the school's name: the name itself, else the first numbered variant. */
  private async freeSlug(schoolName: string): Promise<string> {
    const base = slugify(schoolName).replace(/^(.{0,2})$/, '$1-school');
    const check = await this.checkSlug(base);
    if (check.available) return base;
    if (check.suggestion) return check.suggestion;
    throw new ConflictException('Choose a different school name: no free web address could be made from it.');
  }

  private async create(dto: NewSchool) {
    const email = dto.email;
    const tier = await this.trialTier();
    const now = new Date();
    const result = await this.provisioning.provision(
      {
        name: dto.schoolName,
        slug: dto.slug,
        tierCode: tier,
        timezone: 'Asia/Karachi',
        currency: 'PKR',
        campus: { name: 'Main Campus', code: 'MAIN' },
        admin: { firstName: dto.firstName, lastName: dto.lastName, email, password: dto.password },
      },
      now,
      false,
      true,
    );
    // The owner's record of who registered (shown under Applications as a self-service sign-up).
    await this.prisma.schoolApplication.create({
      data: {
        schoolName: dto.schoolName,
        contactFirstName: dto.firstName,
        contactLastName: dto.lastName,
        designation: dto.designation,
        contactEmail: email,
        contactPhone: dto.phone,
        schoolCity: dto.city,
        requestedTierCode: tier,
        source: 'self_signup',
        status: 'onboarded',
        reviewedAt: now,
        schoolId: result.school.id,
      },
    });
    if (dto.phone) await this.prisma.forSchool(result.school.id).user.update({ where: { id: result.admin.id }, data: { phone: dto.phone } });

    const signInUrl = this.urls.school(dto.slug, '/login');
    const trialEndsAt = result.subscription.trialEndsAt;
    await this.delivery.trySend({
      channel: 'email',
      to: email,
      template: 'school_signup_welcome',
      schoolId: result.school.id,
      data: { name: dto.firstName, schoolName: dto.schoolName, loginId: result.admin.loginId, signInUrl, trialEndsAt: trialEndsAt.toISOString(), ...(dto.emailPassword && { password: dto.password }), provider: dto.method === 'google' ? 'Google' : undefined },
    });
    await this.notifyOwners(dto, result.school.id, trialEndsAt);

    const ticket = await this.tickets.create({ schoolId: result.school.id, userId: result.admin.id, purpose: 'signup' });
    return {
      school: { id: result.school.id, name: dto.schoolName, slug: dto.slug },
      loginId: result.admin.loginId,
      trialEndsAt,
      signInUrl,
      /** Where the generated password went (quick sign-up); null when they chose their own. */
      passwordSentTo: dto.emailPassword ? email : null,
      /** Opens the school's site already signed in (valid 2 minutes, once). */
      continueUrl: this.urls.school(dto.slug, `/welcome?ticket=${ticket}`),
    };
  }

  private async notifyOwners(dto: NewSchool, schoolId: string, trialEndsAt: Date) {
    try {
      const owners = await this.prisma.platformAdmin.findMany({ where: { isActive: true }, select: { email: true } });
      for (const o of owners) {
        await this.delivery.trySend({
          channel: 'email',
          to: o.email,
          template: 'owner_new_signup',
          schoolId,
          data: { schoolName: dto.schoolName, slug: dto.slug, contact: `${dto.firstName} ${dto.lastName} (${dto.designation})`, email: dto.email, phone: dto.phone, city: dto.city, trialEndsAt: trialEndsAt.toISOString(), consoleUrl: this.urls.platform('/schools'), method: { form: 'full form', email: 'email', google: 'Google' }[dto.method] },
        });
      }
    } catch (e) {
      this.log.error(`owner notification failed: ${(e as Error).message}`);
    }
  }

  private async trialTier(): Promise<string> {
    const tiers = await this.prisma.subscriptionTier.findMany({ where: { isActive: true }, select: { code: true }, orderBy: { sortOrder: 'asc' } });
    const codes = tiers.map((t) => t.code);
    const pick = TRIAL_TIER_ORDER.find((c) => codes.includes(c)) ?? codes[0];
    if (!pick) throw new BadRequestException('Sign-up is not available right now. Please contact us.');
    return pick;
  }

  private async taken(slug: string) {
    return !!(await this.prisma.school.findUnique({ where: { slug }, select: { id: true } }));
  }
}
