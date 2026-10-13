import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { isValidSchoolSlug } from '@schoolerp/shared';
import { LoginTicketService } from '../../auth/login-ticket.service.js';
import { VerificationCodesService } from '../../auth/verification-codes.service.js';
import { DeliveryService } from '../../delivery/delivery.service.js';
import { WebUrls } from '../../delivery/web-urls.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SchoolProvisioningService } from '../schools/school-provisioning.service.js';
import type { SignupDto } from './signup.dto.js';

/** Plan a self-service school is attached to during its trial (the trial itself has every feature). */
const TRIAL_TIER_ORDER = ['growth', 'starter'];

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
  ) {}

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
    return this.codes.send({ owner: `signup:${email}`, email, purpose: 'signup' });
  }

  async signup(dto: SignupDto) {
    if (!isValidSchoolSlug(dto.slug)) throw new BadRequestException('This web address is reserved. Choose another.');
    if (await this.taken(dto.slug)) throw new ConflictException('This web address is taken. Choose another.');
    const email = await this.codes.verify(dto.verificationId, `signup:${dto.email}`, dto.code);

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
        schoolCity: dto.city ?? null,
        requestedTierCode: tier,
        source: 'self_signup',
        status: 'onboarded',
        reviewedAt: now,
        schoolId: result.school.id,
      },
    });
    await this.prisma.forSchool(result.school.id).user.update({ where: { id: result.admin.id }, data: { phone: dto.phone } });

    const signInUrl = this.urls.school(dto.slug, '/login');
    const trialEndsAt = result.subscription.trialEndsAt;
    await this.delivery.trySend({
      channel: 'email',
      to: email,
      template: 'school_signup_welcome',
      schoolId: result.school.id,
      data: { name: dto.firstName, schoolName: dto.schoolName, loginId: result.admin.loginId, signInUrl, trialEndsAt: trialEndsAt.toISOString() },
    });
    await this.notifyOwners(dto, result.school.id, trialEndsAt);

    const ticket = await this.tickets.create({ schoolId: result.school.id, userId: result.admin.id, purpose: 'signup' });
    return {
      school: { id: result.school.id, name: dto.schoolName, slug: dto.slug },
      loginId: result.admin.loginId,
      trialEndsAt,
      signInUrl,
      /** Opens the school's site already signed in (valid 2 minutes, once). */
      continueUrl: this.urls.school(dto.slug, `/welcome?ticket=${ticket}`),
    };
  }

  private async notifyOwners(dto: SignupDto, schoolId: string, trialEndsAt: Date) {
    try {
      const owners = await this.prisma.platformAdmin.findMany({ where: { isActive: true }, select: { email: true } });
      for (const o of owners) {
        await this.delivery.trySend({
          channel: 'email',
          to: o.email,
          template: 'owner_new_signup',
          schoolId,
          data: { schoolName: dto.schoolName, slug: dto.slug, contact: `${dto.firstName} ${dto.lastName} (${dto.designation})`, email: dto.email, phone: dto.phone, city: dto.city ?? null, trialEndsAt: trialEndsAt.toISOString(), consoleUrl: this.urls.platform('/schools') },
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
