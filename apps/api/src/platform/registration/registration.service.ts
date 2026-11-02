import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProofsService } from '../../auth/proofs.service.js';
import { SocialIdentityService } from '../../auth/social-identity.service.js';
import { VerificationCodesService } from '../../auth/verification-codes.service.js';
import { assertAnswers, cleanCustomForm, readCustomForm } from '../../common/custom-form.js';
import type { Env } from '../../config/env.js';
import { DeliveryService } from '../../delivery/delivery.service.js';
import { OwnerAlertsService } from '../../delivery/owner-alerts.service.js';
import { WebUrls } from '../../delivery/web-urls.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SignupService } from '../signup/signup.service.js';
import { evaluate, type RegistrationInput } from './checks.js';
import type { ApproveApplicationDto, ChecklistDto, RegEmailVerifyDto, RegGoogleDto, RegisterSchoolDto, RegPhoneCodeDto, RegPhoneVerifyDto, SaveRegistrationFormDto } from './registration.dto.js';
import { CITIES, COUNTRIES, PROVINCES, canonicalProvince, decryptNic, encryptNic, nicHash, parseNic, parseNtn, parsePkMobile } from './identity.js';
import { readPolicy, trialFor } from './trial-policy.js';

const FORM_KIND = 'school_registration';
/** Field ids the application itself uses; the owner's extra questions may not reuse them. */
/** The address as the mail system sees it: lower-case, and for gmail without dots and +tags. */
export function canonicalEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') return `${local.split('+')[0]!.replace(/\./g, '')}@gmail.com`;
  return `${local}@${domain}`;
}

const RESERVED_IDS = ['schoolName', 'ntn', 'nic', 'email', 'phone', 'city', 'province', 'country', 'address'];
const FAIL_LIMIT_IP = 15;
const FAIL_WINDOW = 24 * 3600;
const CHECKLIST = ['cnic', 'ntn', 'school', 'contact'] as const;
/** What the team must have confirmed before an application can be approved. */
const REQUIRED_CHECKS = ['cnic', 'ntn', 'school'] as const;

/**
 * Applying to join. The applicant proves their email (and phone), fills in the owner's and the school's
 * details and submits. Nothing is created: the application waits for the owner's team, who check the
 * CNIC, NTN and school by hand (NADRA's and FBR's portals, a call) and tick a checklist. Only when the
 * owner approves is the school created, with its first admin, and the record kept tidy and linked.
 */
@Injectable()
export class RegistrationService {
  private readonly log = new Logger(RegistrationService.name);
  private readonly secret: string;
  /** A real WhatsApp / SMS provider is connected (or this is not production, where codes go to the outbox). */
  readonly phoneChannelReady: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly codes: VerificationCodesService,
    private readonly proofs: ProofsService,
    private readonly social: SocialIdentityService,
    private readonly signup: SignupService,
    private readonly delivery: DeliveryService,
    private readonly alerts: OwnerAlertsService,
    private readonly urls: WebUrls,
    config: ConfigService<Env, true>,
  ) {
    this.secret = config.get('REGISTRATION_HASH_SECRET', { infer: true }) ?? config.get('JWT_ACCESS_SECRET', { infer: true });
    this.phoneChannelReady = config.get('WHATSAPP_DRIVER', { infer: true }) === 'cloud' || config.get('SMS_DRIVER', { infer: true }) === 'twilio' || config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  // --- The form -------------------------------------------------------------------------------

  private async stored() {
    const row = await this.prisma.platformForm.findUnique({ where: { kind: FORM_KIND } });
    return { form: readCustomForm(row?.definition), policy: readPolicy(row?.settings) };
  }

  /** What the application page shows: the extra questions, the choices and the trial rules. */
  async publicForm() {
    const { form, policy } = await this.stored();
    return {
      form,
      countries: policy.allowedCountries.length ? policy.allowedCountries : [...COUNTRIES],
      provinces: PROVINCES,
      cities: CITIES,
      schoolTypes: policy.schoolTypes,
      // Required only when a code can actually be delivered; the owner is warned in the console otherwise.
      requirePhoneCode: policy.requirePhoneCode && this.phoneChannelReady,
      phoneChannelReady: this.phoneChannelReady,
      trialBands: policy.trialBands.map(({ upTo, days, label }) => ({ upTo, days, label })),
      minStudents: policy.minStudents,
      designations: ['Owner', 'Chairman / Director', 'Principal', 'Administrator'],
    };
  }

  // --- Proving the email and the phone ---------------------------------------------------------

  sendEmailCode(email: string) {
    return this.assertEmailFree(email).then(() => this.sendEmailCodeNow(email));
  }

  /** One email, one application: gmail dots and +tags count as the same address. */
  private async assertEmailFree(email: string) {
    const key = canonicalEmail(email);
    const live = await this.prisma.schoolRegistration.findMany({ where: { status: { in: ['pending', 'approved'] } }, select: { email: true } });
    if (live.some((a) => canonicalEmail(a.email) === key)) throw new ConflictException('An application with this email already exists. Use a different email, or wait for our team to review it.');
  }

  private sendEmailCodeNow(email: string) {
    return this.codes.send({ owner: `reg:email:${email}`, email, purpose: 'signup' });
  }

  async verifyEmail(dto: RegEmailVerifyDto) {
    const email = await this.codes.verify(dto.verificationId, `reg:email:${dto.email}`, dto.code);
    return { email, proof: await this.proofs.issue({ kind: 'email', value: email, method: 'email' }) };
  }

  async verifyGoogle(dto: RegGoogleDto) {
    const who = await this.social.verify(dto.provider, dto.credential, dto.nonce);
    return { email: who.email, firstName: who.firstName, lastName: who.lastName, proof: await this.proofs.issue({ kind: 'email', value: who.email, method: 'google' }) };
  }

  async sendPhoneCode(dto: RegPhoneCodeDto) {
    if (!this.phoneChannelReady) throw new ServiceUnavailableException('WhatsApp verification is not available right now.');
    const phone = parsePkMobile(dto.phone);
    if (!phone) throw new BadRequestException('Enter a Pakistani mobile number such as 0300 1234567.');
    return this.codes.sendPhone({ owner: `reg:phone:${phone}`, phone, channel: dto.channel ?? 'whatsapp', purpose: 'signup' });
  }

  async verifyPhone(dto: RegPhoneVerifyDto) {
    const phone = parsePkMobile(dto.phone);
    if (!phone) throw new BadRequestException('Enter a Pakistani mobile number such as 0300 1234567.');
    await this.codes.verify(dto.verificationId, `reg:phone:${phone}`, dto.code);
    return { phone, proof: await this.proofs.issue({ kind: 'phone', value: phone, method: 'whatsapp' }) };
  }

  // --- Applying ---------------------------------------------------------------------------------

  async register(dto: RegisterSchoolDto, meta: { ip?: string; userAgent?: string }) {
    if (!dto.declaration) throw new BadRequestException('Confirm that the details are true and accept the terms.');
    const ipKey = `ip:${meta.ip ?? 'unknown'}`;
    if (await this.proofs.tooManyFailures(ipKey, FAIL_LIMIT_IP)) throw new HttpException('Too many unsuccessful attempts. Try again tomorrow, or contact us.', HttpStatus.TOO_MANY_REQUESTS);
    const ntnKey = `ntn:${dto.ntn.replace(/\D/g, '')}`;
    return this.proofs.withLock(ntnKey, async () => {
      const stored = await this.stored();
      const policy = { ...stored.policy, requirePhoneCode: stored.policy.requirePhoneCode && this.phoneChannelReady };
      const answers = assertAnswers(stored.form, dto.answers);

      const input: RegistrationInput = { schoolName: dto.schoolName, ntn: dto.ntn, country: dto.country, province: dto.province, city: dto.city, address: dto.address, studentCount: dto.studentCount, teacherCount: dto.teacherCount, staffCount: dto.staffCount, nic: dto.nic, phone: dto.phone };
      const phone = parsePkMobile(dto.phone);
      const nic = parseNic(dto.nic);
      const ntn = parseNtn(dto.ntn);
      const emailProof = await this.proofs.peek(dto.emailProof, 'email', dto.email);
      const phoneProof = phone ? await this.proofs.peek(dto.phoneProof, 'phone', phone) : null;
      const hash = nic ? nicHash(nic.digits, this.secret) : '';

      const { checks, passed } = evaluate(input, {
        policy,
        emailProof: emailProof && (emailProof.method === 'google' || emailProof.method === 'email') ? { method: emailProof.method } : null,
        phoneProof: phoneProof && (phoneProof.method === 'whatsapp' || phoneProof.method === 'sms') ? { method: phoneProof.method } : null,
        duplicates: await this.duplicates(dto, ntn?.formatted, hash),
      });
      if (!passed || !nic || !ntn || !phone) {
        await this.proofs.recordFailure(ipKey, FAIL_WINDOW);
        const reasons = [...new Set(checks.filter((c) => !c.passed).map((c) => c.reason ?? c.label))];
        throw new UnprocessableEntityException({ message: 'The application could not be accepted. Please correct the details below.', reasons, checks: checks.map(({ key, label, passed: p }) => ({ key, label, passed: p })) });
      }
      // The receipts are single-use: a second submit with the same ones is refused.
      if (!(await this.proofs.consume([dto.emailProof, ...(policy.requirePhoneCode ? [dto.phoneProof] : [])]))) throw new ConflictException('This verification was already used. Verify again.');

      let row;
      try {
        row = await this.prisma.schoolRegistration.create({
          data: {
            status: 'pending', schoolName: dto.schoolName, ntn: ntn.formatted, registrationNo: dto.registrationNo ?? null, ownerFirstName: dto.ownerFirstName, ownerLastName: dto.ownerLastName, designation: dto.designation,
            ownerNicHash: hash, ownerNicLast4: nic.last4, ownerNicEnc: encryptNic(nic.digits, this.secret), email: dto.email, phone, emailMethod: emailProof!.method, phoneMethod: phoneProof?.method ?? null,
            country: dto.country, province: canonicalProvince(dto.province) ?? dto.province, city: dto.city, address: dto.address, schoolType: dto.schoolType ?? null,
            studentCount: dto.studentCount, teacherCount: dto.teacherCount, staffCount: dto.staffCount, answers: answers as Prisma.InputJsonValue, checks: checks as unknown as Prisma.InputJsonValue, failureReasons: [], ip: meta.ip ?? null, userAgent: meta.userAgent?.slice(0, 300) ?? null,
          },
          select: { id: true },
        });
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') throw new ConflictException('An application for this school, owner or email is already waiting for review.');
        throw e;
      }
      const reference = row.id.slice(-8).toUpperCase();
      await this.delivery.trySend({ channel: 'email', to: dto.email, template: 'registration_received', data: { name: dto.ownerFirstName, schoolName: dto.schoolName, reference } });
      const people = dto.studentCount + dto.teacherCount + dto.staffCount;
      await this.alerts.raise({
        kind: 'school_application', title: `New application: ${dto.schoolName}`, body: `${dto.ownerFirstName} ${dto.ownerLastName} (${dto.designation}) · ${dto.city}, ${dto.province} · ${people} people. Waiting for verification.`, link: '/applications', actor: dto.email,
        email: { template: 'owner_alert', data: { title: `New school application: ${dto.schoolName}`, lines: [`${dto.ownerFirstName} ${dto.ownerLastName} (${dto.designation}), ${dto.email}, ${phone}`, `${dto.city}, ${dto.province}: ${dto.studentCount} students, ${dto.teacherCount} teachers`, 'Verify the CNIC and NTN, then approve or decline in the console.'], url: this.urls.platform('/applications') } },
      });
      this.log.log(`application received: ${dto.schoolName} (${reference})`);
      return { reference, message: 'Your application was received. Our team will verify your details, which usually takes a few working days. When it is approved, your User ID and password are emailed to you.' };
    });
  }

  /** Whether an application (waiting or approved) already exists for the same NTN, owner, email or school name in the city. */
  private async duplicates(dto: RegisterSchoolDto, ntnFormatted: string | undefined, hash: string) {
    const live = { status: { in: ['pending', 'approved'] as ('pending' | 'approved')[] } };
    const [ntn, owner, email, name] = await Promise.all([
      ntnFormatted ? this.prisma.schoolRegistration.count({ where: { ...live, ntn: ntnFormatted } }) : 0,
      hash ? this.prisma.schoolRegistration.count({ where: { ...live, ownerNicHash: hash } }) : 0,
      this.prisma.schoolRegistration.findMany({ where: live, select: { email: true } }).then((l) => l.filter((a) => canonicalEmail(a.email) === canonicalEmail(dto.email)).length),
      this.prisma.schoolRegistration.count({ where: { ...live, schoolName: { equals: dto.schoolName, mode: 'insensitive' }, city: { equals: dto.city, mode: 'insensitive' } } }),
    ]);
    return { ntn: ntn > 0, owner: owner > 0, email: email > 0, nameInCity: name > 0 };
  }

  // --- Owner console: the form and rules --------------------------------------------------------

  async ownerForm() {
    const { form, policy } = await this.stored();
    return { form, policy, reservedIds: RESERVED_IDS, provinces: PROVINCES, phoneChannelReady: this.phoneChannelReady };
  }

  async saveOwnerForm(dto: SaveRegistrationFormDto, by: string) {
    const form = cleanCustomForm(dto.form, RESERVED_IDS);
    const policy = readPolicy({ ...dto.policy, trialBands: dto.policy.trialBands.map((b) => ({ ...b, upTo: b.upTo ?? null })) });
    if (policy.trialBands.length !== dto.policy.trialBands.length || policy.trialBands[policy.trialBands.length - 1]!.upTo !== null) throw new BadRequestException('Trial lengths need at least one band, the last one open-ended (no upper limit).');
    if (policy.minStudents >= policy.maxStudents) throw new BadRequestException('The smallest school must be smaller than the largest.');
    await this.prisma.platformForm.upsert({
      where: { kind: FORM_KIND },
      create: { kind: FORM_KIND, definition: form as unknown as Prisma.InputJsonValue, settings: policy as unknown as Prisma.InputJsonValue, updatedBy: by },
      update: { definition: form as unknown as Prisma.InputJsonValue, settings: policy as unknown as Prisma.InputJsonValue, updatedBy: by },
    });
    return this.ownerForm();
  }

  // --- Owner console: reviewing applications ------------------------------------------------------

  private static readonly LIST_SELECT = {
    id: true, status: true, schoolName: true, ntn: true, registrationNo: true, ownerFirstName: true, ownerLastName: true, designation: true, ownerNicLast4: true, email: true, phone: true, emailMethod: true, phoneMethod: true,
    country: true, province: true, city: true, address: true, schoolType: true, studentCount: true, teacherCount: true, staffCount: true, answers: true, checks: true, verification: true, decidedAt: true, decidedBy: true, decisionNote: true, trialDays: true, schoolId: true, createdAt: true,
  } satisfies Prisma.SchoolRegistrationSelect;

  async applications(q: { status?: 'pending' | 'approved' | 'rejected'; q?: string; page: number; pageSize: number }) {
    const where: Prisma.SchoolRegistrationWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.q && { OR: [{ schoolName: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { ntn: { contains: q.q } }, { city: { contains: q.q, mode: 'insensitive' } }] }),
    };
    const [rows, total, groups] = await Promise.all([
      this.prisma.schoolRegistration.findMany({ where, orderBy: [{ createdAt: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize, select: RegistrationService.LIST_SELECT }),
      this.prisma.schoolRegistration.count({ where }),
      this.prisma.schoolRegistration.groupBy({ by: ['status'], _count: true }),
    ]);
    const policy = (await this.stored()).policy;
    const count = (s: string) => groups.find((g) => g.status === s)?._count ?? 0;
    return { items: rows.map((r) => ({ ...r, suggestedTrialDays: trialFor(policy, r.studentCount + r.teacherCount + r.staffCount).days })), total, pending: count('pending'), approved: count('approved'), rejected: count('rejected'), page: q.page, pageSize: q.pageSize };
  }

  /** The full CNIC, for the team to type into NADRA's portal: only while the application is waiting. */
  async nic(id: string) {
    const r = await this.prisma.schoolRegistration.findUnique({ where: { id }, select: { status: true, ownerNicEnc: true } });
    if (!r) throw new NotFoundException('Application not found');
    if (r.status !== 'pending' || !r.ownerNicEnc) throw new ConflictException('The CNIC is erased once an application is decided.');
    const digits = decryptNic(r.ownerNicEnc, this.secret);
    if (!digits) throw new ServiceUnavailableException('The CNIC could not be read.');
    return { nic: parseNic(digits)?.formatted ?? digits };
  }

  async saveChecklist(id: string, dto: ChecklistDto, by: string) {
    const items = Object.fromEntries(CHECKLIST.map((k) => [k, dto[k]]));
    const { count } = await this.prisma.schoolRegistration.updateMany({ where: { id, status: 'pending' }, data: { verification: { items, note: dto.note ?? null, by, at: new Date().toISOString() } as unknown as Prisma.InputJsonValue } });
    if (!count) throw new ConflictException('Only waiting applications can be checked.');
    return { id, items };
  }

  /** Approving creates the school. The application is claimed first, so two owners cannot both approve it. */
  async approve(id: string, dto: ApproveApplicationDto, by: string) {
    const app = await this.prisma.schoolRegistration.findUnique({ where: { id } });
    if (!app) throw new NotFoundException('Application not found');
    const items = ((app.verification as { items?: Record<string, boolean> } | null)?.items ?? {}) as Record<string, boolean>;
    const missing = REQUIRED_CHECKS.filter((k) => !items[k]);
    if (app.status === 'pending' && missing.length) throw new BadRequestException(`Tick the checks first: ${missing.map((k) => ({ cnic: 'CNIC verified', ntn: 'NTN verified', school: 'school verified' })[k]).join(', ')}.`);
    const claimed = await this.prisma.schoolRegistration.updateMany({ where: { id, status: 'pending' }, data: { status: 'approved', decidedBy: by, decidedAt: new Date() } });
    if (!claimed.count) throw new ConflictException('This application was already decided.');
    const policy = (await this.stored()).policy;
    const days = dto.trialDays ?? trialFor(policy, app.studentCount + app.teacherCount + app.staffCount).days;
    try {
      const created = await this.signup.createSchool({
        schoolName: app.schoolName, city: app.city, firstName: app.ownerFirstName, lastName: app.ownerLastName, designation: app.designation, email: app.email, phone: app.phone, trialDays: days,
        method: app.emailMethod === 'google' ? 'google' : 'email', summary: `${app.studentCount} students, ${app.teacherCount} teachers, ${app.staffCount} staff in ${app.city}. Verified by the team.`,
      });
      // The record is complete: linked to its school, the CNIC erased (only its fingerprint and last 4 digits stay).
      await this.prisma.schoolRegistration.update({ where: { id }, data: { schoolId: created.school.id, trialDays: days, ownerNicEnc: null } });
      this.log.log(`application approved: ${app.schoolName} → ${created.school.slug}`);
      return { id, school: created.school, trialDays: days, loginId: created.loginId };
    } catch (e) {
      await this.prisma.schoolRegistration.update({ where: { id }, data: { status: 'pending', decidedBy: null, decidedAt: null } });
      throw e;
    }
  }

  async reject(id: string, reason: string, by: string) {
    const app = await this.prisma.schoolRegistration.findUnique({ where: { id }, select: { ownerFirstName: true, schoolName: true, email: true } });
    if (!app) throw new NotFoundException('Application not found');
    const { count } = await this.prisma.schoolRegistration.updateMany({ where: { id, status: 'pending' }, data: { status: 'rejected', decidedBy: by, decidedAt: new Date(), decisionNote: reason, ownerNicEnc: null } });
    if (!count) throw new ConflictException('This application was already decided.');
    await this.delivery.trySend({ channel: 'email', to: app.email, template: 'registration_rejected', data: { name: app.ownerFirstName, schoolName: app.schoolName, reason } });
    return { id, status: 'rejected' as const };
  }
}
