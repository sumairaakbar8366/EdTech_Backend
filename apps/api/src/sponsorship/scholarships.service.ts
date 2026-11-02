import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { assertAnswers, cleanCustomForm, readCustomForm, type CustomForm } from '../common/custom-form.js';
import { DeliveryService } from '../delivery/delivery.service.js';
import { OwnerAlertsService } from '../delivery/owner-alerts.service.js';
import { WebUrls } from '../delivery/web-urls.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { schoolSnapshot } from '../insights/school-snapshot.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../communication/notifications.service.js';
import type { AddGrantsDto, AwardCandidatesDto, DecideCandidatesDto, DecideRequestDto, ProgramDto, SendOfferDto, SponsorDto, SubmitRequestDto } from './sponsorship.dto.js';

const FORM_KIND = 'scholarship_request';
const OFFER_DAYS = 30;
const hash = (t: string) => createHash('sha256').update(t).digest('hex');
const n = (v: unknown) => (v == null ? 0 : Number(v));
const money = (v: number, cur: string) => `${cur} ${Math.round(v).toLocaleString('en-PK')}`;

/** The request form every school is sent unless the owner changes it. */
export const DEFAULT_SCHOLARSHIP_FORM: CustomForm = {
  intro: 'Tell us about the children who would benefit. Only genuine, verifiable needs are considered.',
  fields: [
    { id: 'beneficiaries', type: 'textarea', label: 'Who would receive the scholarship? (class, number of children, how they were chosen)', section: null, help: null, required: true, options: [], minLength: 20, maxLength: 2000, min: null, max: null },
    { id: 'need', type: 'select', label: 'Main reason for support', section: null, help: null, required: true, options: ['Families cannot afford fees', 'Orphans or single-parent homes', 'Talented students', 'Girls’ education', 'Special needs', 'Other'], minLength: null, maxLength: null, min: null, max: null },
    { id: 'verifies', type: 'checkbox', label: 'The school will verify each child’s need before the scholarship is used', section: null, help: null, required: true, options: [], minLength: null, maxLength: null, min: null, max: null },
    { id: 'event', type: 'text', label: 'Event or occasion this relates to (if any)', section: null, help: null, required: false, options: [], minLength: null, maxLength: 200, min: null, max: null },
    { id: 'bankNote', type: 'textarea', label: 'Anything else we should know', section: null, help: null, required: false, options: [], minLength: null, maxLength: 2000, min: null, max: null },
  ],
};

@Injectable()
export class ScholarshipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: DeliveryService,
    private readonly alerts: OwnerAlertsService,
    private readonly urls: WebUrls,
    private readonly notifications: NotificationsService,
  ) {}

  // --- The request form ------------------------------------------------------------------------

  async form(): Promise<CustomForm> {
    const row = await this.prisma.platformForm.findUnique({ where: { kind: FORM_KIND } });
    return row ? readCustomForm(row.definition) : DEFAULT_SCHOLARSHIP_FORM;
  }

  async saveForm(dto: Parameters<typeof cleanCustomForm>[0], by: string) {
    const form = cleanCustomForm(dto);
    const definition = form as unknown as Prisma.InputJsonValue;
    await this.prisma.platformForm.upsert({ where: { kind: FORM_KIND }, create: { kind: FORM_KIND, definition, updatedBy: by }, update: { definition, updatedBy: by } });
    return form;
  }

  // --- Sponsors and programs ---------------------------------------------------------------------

  sponsors() {
    return this.prisma.sponsor.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { programs: true } } } });
  }
  addSponsor(dto: SponsorDto) {
    return this.prisma.sponsor.create({ data: dto });
  }
  async updateSponsor(id: string, dto: SponsorDto) {
    await this.must(this.prisma.sponsor.findUnique({ where: { id }, select: { id: true } }), 'Sponsor');
    return this.prisma.sponsor.update({ where: { id }, data: dto });
  }
  async removeSponsor(id: string) {
    await this.prisma.sponsor.delete({ where: { id } }).catch(() => { throw new NotFoundException('Sponsor not found'); });
  }

  async programs() {
    const [rows, grants, offers] = await Promise.all([
      this.prisma.scholarshipProgram.findMany({ orderBy: [{ createdAt: 'desc' }], include: { sponsor: { select: { id: true, name: true } } } }),
      this.prisma.scholarshipGrant.groupBy({ by: ['programId', 'status'], _count: true, _sum: { amount: true } }),
      this.prisma.scholarshipOffer.groupBy({ by: ['programId', 'status'], _count: true }),
    ]);
    return rows.map((p) => {
      const g = grants.filter((x) => x.programId === p.id && x.status !== 'cancelled');
      const o = offers.filter((x) => x.programId === p.id);
      const students = g.reduce((s, x) => s + x._count, 0);
      const committed = g.reduce((s, x) => s + n(x._sum.amount), 0);
      const disbursed = n(grants.find((x) => x.programId === p.id && x.status === 'disbursed')?._sum.amount);
      return {
        ...p, awardAmount: p.awardAmount === null ? null : n(p.awardAmount), budget: p.budget === null ? null : n(p.budget),
        offersSent: o.reduce((s, x) => s + x._count, 0), offersAnswered: o.filter((x) => x.status === 'submitted').reduce((s, x) => s + x._count, 0), students, committed, disbursed,
        slotsLeft: Math.max(0, p.slots - students),
      };
    });
  }

  private programData(dto: ProgramDto) {
    return {
      title: dto.title, sponsorId: dto.sponsorId ?? null, description: dto.description ?? null, criteria: dto.criteria ?? null, awardAmount: dto.awardAmount ?? null, budget: dto.budget ?? null,
      slots: dto.slots ?? 0, deadline: dto.deadline ? new Date(`${dto.deadline}T00:00:00Z`) : null, status: dto.status ?? 'draft',
      targetLevels: [...new Set(dto.targetLevels ?? [])].sort((a, b) => a - b), period: dto.period ?? 'yearly', currentPeriod: dto.currentPeriod || null, continuesToUndergrad: dto.continuesToUndergrad ?? false,
      minAverage: dto.minAverage ?? 70, minAttendance: dto.minAttendance ?? 85, needRequired: dto.needRequired ?? true,
    };
  }
  addProgram(dto: ProgramDto) {
    return this.prisma.scholarshipProgram.create({ data: this.programData(dto) });
  }
  async updateProgram(id: string, dto: ProgramDto) {
    await this.must(this.prisma.scholarshipProgram.findUnique({ where: { id }, select: { id: true } }), 'Program');
    return this.prisma.scholarshipProgram.update({ where: { id }, data: this.programData(dto) });
  }

  // --- Opportunities and offers --------------------------------------------------------------------

  async opportunities(status?: string) {
    const rows = await this.prisma.schoolOpportunity.findMany({ where: status ? { status } : { status: { in: ['new', 'offered'] } }, orderBy: { createdAt: 'desc' }, take: 100, include: { school: { select: { id: true, name: true } }, _count: { select: { offers: true } } } });
    return rows.map(({ _count, ...o }) => ({ ...o, offers: _count.offers }));
  }

  async dismissOpportunity(id: string) {
    const { count } = await this.prisma.schoolOpportunity.updateMany({ where: { id }, data: { status: 'dismissed' } });
    if (!count) throw new NotFoundException('Opportunity not found');
    return { id, status: 'dismissed' };
  }

  /**
   * One click: the school's administrators get a private link to the request form by email and in the
   * app. From an opportunity the school is known; otherwise `schoolId` names it.
   */
  async sendOffer(dto: SendOfferDto, opportunityId: string | null, sentBy: string) {
    const opp = opportunityId ? await this.prisma.schoolOpportunity.findUnique({ where: { id: opportunityId } }) : null;
    if (opportunityId && !opp) throw new NotFoundException('Opportunity not found');
    const schoolId = opp?.schoolId ?? dto.schoolId;
    if (!schoolId) throw new BadRequestException('Choose the school');
    const program = dto.programId
      ? await this.prisma.scholarshipProgram.findUnique({ where: { id: dto.programId }, include: { sponsor: true } })
      : await this.prisma.scholarshipProgram.findFirst({ where: { status: 'recruiting' }, orderBy: { createdAt: 'desc' }, include: { sponsor: true } });
    if (!program) throw new BadRequestException(dto.programId ? 'Program not found' : 'There is no program looking for schools right now. Create one first.');
    if (program.status === 'closed' || program.status === 'draft') throw new BadRequestException(`A ${program.status} program cannot send offers. Set it to “recruiting” or “live” first.`);
    const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, status: true } });
    if (!school || school.status !== 'active') throw new NotFoundException('School not found or not active');
    const open = await this.prisma.scholarshipOffer.findFirst({ where: { schoolId, programId: program.id, status: { in: ['sent', 'viewed'] }, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (open) throw new ConflictException('This school already has an open offer for this program.');

    const token = randomBytes(32).toString('base64url');
    const offer = await this.prisma.scholarshipOffer.create({
      data: { programId: program.id, schoolId, opportunityId: opp?.id ?? null, tokenHash: hash(token), message: dto.message ?? null, expiresAt: new Date(Date.now() + OFFER_DAYS * 86_400_000), sentBy },
    });
    if (opp) await this.prisma.schoolOpportunity.update({ where: { id: opp.id }, data: { status: 'offered' } });

    const url = this.urls.site(`/scholarship/${token}`);
    const admins = await this.prisma.forSchool(schoolId).user.findMany({ where: { status: 'active', NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: 'school_admin' } } } }, select: { id: true, email: true } });
    const emails = [...new Set(admins.map((a) => a.email).filter((e): e is string => !!e))];
    for (const to of emails) {
      await this.delivery.trySend({ channel: 'email', to, schoolId, template: 'scholarship_offer', data: { schoolName: school.name, programTitle: program.title, sponsor: program.sponsor?.name ?? null, reason: opp ? opp.title : null, message: dto.message ?? null, url, deadline: program.deadline ? program.deadline.toISOString().slice(0, 10) : null, amount: program.awardAmount ? money(n(program.awardAmount), program.currency) : null } });
    }
    return { id: offer.id, school: school.name, program: program.title, emailedTo: emails.length, expiresAt: offer.expiresAt };
  }

  async offers(status?: string) {
    return this.prisma.scholarshipOffer.findMany({ where: status ? { status: status as never } : {}, orderBy: { sentAt: 'desc' }, take: 200, select: { id: true, status: true, sentAt: true, viewedAt: true, respondedAt: true, expiresAt: true, message: true, school: { select: { id: true, name: true } }, program: { select: { id: true, title: true } }, opportunity: { select: { title: true } } } });
  }

  async withdrawOffer(id: string) {
    const { count } = await this.prisma.scholarshipOffer.updateMany({ where: { id, status: { in: ['sent', 'viewed'] } }, data: { status: 'withdrawn', respondedAt: new Date() } });
    if (!count) throw new ConflictException('Only offers that are still waiting can be withdrawn.');
    return { id, status: 'withdrawn' };
  }

  // --- The school's private page --------------------------------------------------------------------

  private async byToken(token: string) {
    const offer = await this.prisma.scholarshipOffer.findUnique({ where: { tokenHash: hash(token) }, include: { school: { select: { id: true, name: true } }, program: { include: { sponsor: { select: { name: true } } } }, request: { select: { id: true } } } });
    if (!offer) throw new NotFoundException('This link is not valid.');
    return offer;
  }

  async publicOffer(token: string) {
    const offer = await this.byToken(token);
    const expired = offer.expiresAt < new Date();
    if (offer.status === 'sent' && !expired) await this.prisma.scholarshipOffer.update({ where: { id: offer.id }, data: { status: 'viewed', viewedAt: new Date() } });
    const open = (offer.status === 'sent' || offer.status === 'viewed') && !expired;
    return {
      school: offer.school.name, status: expired && open ? 'expired' : offer.status, open, message: offer.message, expiresAt: offer.expiresAt,
      program: { title: offer.program.title, description: offer.program.description, criteria: offer.program.criteria, sponsor: offer.program.sponsor?.name ?? null, awardAmount: offer.program.awardAmount ? n(offer.program.awardAmount) : null, currency: offer.program.currency, deadline: offer.program.deadline },
      form: open ? await this.form() : null,
    };
  }

  async submit(token: string, dto: SubmitRequestDto) {
    const offer = await this.byToken(token);
    if (offer.expiresAt < new Date()) throw new GoneException('This offer has expired. Please contact Skool EdTech.');
    const answers = assertAnswers(await this.form(), dto.answers);
    // Claim the offer first: two submissions of the same link cannot both win.
    const claimed = await this.prisma.scholarshipOffer.updateMany({ where: { id: offer.id, status: { in: ['sent', 'viewed'] } }, data: { status: 'submitted', respondedAt: new Date() } });
    if (!claimed.count) throw new ConflictException('This offer was already answered.');
    await this.prisma.scholarshipRequest.create({ data: { offerId: offer.id, programId: offer.programId, schoolId: offer.schoolId, answers: answers as Prisma.InputJsonValue, studentsRequested: dto.studentsRequested, contactName: dto.contactName, contactEmail: dto.contactEmail } });
    await this.alerts.raise({ kind: 'scholarship_request', title: `Scholarship request: ${offer.school.name}`, body: `${dto.contactName} asked for ${dto.studentsRequested} student(s) under “${offer.program.title}”.`, link: '/scholarships?tab=requests', schoolId: offer.schoolId, actor: dto.contactEmail });
    return { message: 'Thank you. Your request was sent to the Skool EdTech team, who will contact you.' };
  }

  async decline(token: string) {
    const offer = await this.byToken(token);
    const { count } = await this.prisma.scholarshipOffer.updateMany({ where: { id: offer.id, status: { in: ['sent', 'viewed'] } }, data: { status: 'declined', respondedAt: new Date() } });
    if (!count) throw new ConflictException('This offer was already answered.');
    return { message: 'Understood. The offer was declined.' };
  }

  // --- Requests and the children who receive scholarships --------------------------------------------

  async requests(status?: string) {
    const rows = await this.prisma.scholarshipRequest.findMany({ where: status ? { status: status as never } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { school: { select: { id: true, name: true } }, program: { select: { id: true, title: true, awardAmount: true } }, grants: { select: { id: true, studentName: true, className: true, amount: true, status: true } } } });
    return rows.map((r) => ({ ...r, program: { ...r.program, awardAmount: r.program.awardAmount === null ? null : n(r.program.awardAmount) }, grants: r.grants.map((g) => ({ ...g, amount: n(g.amount) })) }));
  }

  async decide(id: string, dto: DecideRequestDto) {
    const { count } = await this.prisma.scholarshipRequest.updateMany({ where: { id, status: 'submitted' }, data: { status: dto.status, reviewNote: dto.note ?? null, decidedAt: new Date() } });
    if (!count) throw new ConflictException('This request was already decided.');
    if (dto.status === 'approved') {
      const r = await this.prisma.scholarshipRequest.findUnique({ where: { id }, select: { schoolId: true, program: { select: { title: true } } } });
      if (r) await this.notifySchool(r.schoolId, `Approved: ${r.program.title}`, 'Open Scholarship candidates to see the students who qualify and put names forward.', '/scholarship-candidates');
    }
    return { id, status: dto.status };
  }

  private async notifySchool(schoolId: string, title: string, body: string, link: string) {
    const admins = await this.prisma.forSchool(schoolId).user.findMany({ where: { status: 'active', NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: { in: ['school_admin', 'principal'] } } } } }, select: { id: true } });
    await this.notifications.notify(schoolId, admins.map((a) => a.id), { eventType: 'scholarship_candidates', title, body, link });
  }

  // --- Students the schools put forward, by cycle -------------------------------------------------

  async candidates(programId: string, period?: string, status?: string) {
    const periods = await this.prisma.scholarshipCandidate.findMany({ where: { programId }, distinct: ['periodLabel'], select: { periodLabel: true }, orderBy: { periodLabel: 'desc' } });
    const program = await this.must(this.prisma.scholarshipProgram.findUnique({ where: { id: programId } }), 'Program');
    const chosen = period || program.currentPeriod || periods[0]?.periodLabel || String(new Date().getUTCFullYear());
    const rows = await this.prisma.scholarshipCandidate.findMany({ where: { programId, periodLabel: chosen, ...(status && { status }) }, orderBy: [{ school: { name: 'asc' } }, { rankScore: 'desc' }], include: { school: { select: { id: true, name: true } } } });
    return { period: chosen, periods: periods.map((p) => p.periodLabel), program: { id: program.id, title: program.title, slots: program.slots, targetLevels: program.targetLevels, continuesToUndergrad: program.continuesToUndergrad }, items: rows };
  }

  async decideCandidates(dto: DecideCandidatesDto) {
    const { count } = await this.prisma.scholarshipCandidate.updateMany({ where: { id: { in: dto.ids }, status: { in: ['confirmed', 'selected', 'rejected'] } }, data: { status: dto.status, decidedAt: dto.status === 'confirmed' ? null : new Date() } });
    return { updated: count };
  }

  /** Turns the selected students of a cycle into grants and tells each school who was chosen. */
  async awardCandidates(dto: AwardCandidatesDto) {
    const program = await this.must(this.prisma.scholarshipProgram.findUnique({ where: { id: dto.programId } }), 'Program');
    const selected = await this.prisma.scholarshipCandidate.findMany({ where: { programId: program.id, periodLabel: dto.period, status: 'selected' }, orderBy: { rankScore: 'desc' } });
    if (!selected.length) throw new BadRequestException('Select students first.');
    const used = await this.prisma.scholarshipGrant.count({ where: { programId: program.id, status: { not: 'cancelled' } } });
    if (program.slots > 0 && used + selected.length > program.slots) throw new BadRequestException(`The program has only ${Math.max(0, program.slots - used)} place(s) left; you selected ${selected.length}.`);
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    const bySchool = new Map<string, string[]>();
    for (const c of selected) {
      const req = await this.prisma.scholarshipRequest.findFirst({ where: { programId: program.id, schoolId: c.schoolId, status: 'approved' }, select: { id: true } });
      const grant = await this.prisma.scholarshipGrant.create({ data: { programId: program.id, schoolId: c.schoolId, requestId: req?.id ?? null, studentName: c.studentName, className: c.className, amount: program.awardAmount ?? 0, awardedOn: today, note: `${dto.period}` } });
      await this.prisma.scholarshipCandidate.update({ where: { id: c.id }, data: { status: 'awarded', grantId: grant.id, decidedAt: new Date() } });
      bySchool.set(c.schoolId, [...(bySchool.get(c.schoolId) ?? []), `${c.studentName} (${c.className})`]);
    }
    for (const [schoolId, names] of bySchool) await this.notifySchool(schoolId, `Scholarship awarded: ${program.title}`, `Selected for ${dto.period}: ${names.join(', ')}.`, '/scholarship-candidates');
    return { awarded: selected.length, schools: bySchool.size };
  }

  async addGrants(requestId: string, dto: AddGrantsDto) {
    const req = await this.prisma.scholarshipRequest.findUnique({ where: { id: requestId }, include: { program: true } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.status !== 'approved') throw new BadRequestException('Approve the request before naming the children who receive it.');
    const used = await this.prisma.scholarshipGrant.count({ where: { programId: req.programId, status: { not: 'cancelled' } } });
    if (req.program.slots > 0 && used + dto.grants.length > req.program.slots) throw new BadRequestException(`The program has only ${Math.max(0, req.program.slots - used)} place(s) left.`);
    const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
    await this.prisma.scholarshipGrant.createMany({ data: dto.grants.map((g) => ({ programId: req.programId, schoolId: req.schoolId, requestId, studentName: g.studentName, className: g.className ?? null, amount: g.amount, awardedOn: today, note: g.note ?? null })) });
    return { added: dto.grants.length };
  }

  async setGrantStatus(id: string, status: 'pledged' | 'disbursed' | 'cancelled') {
    const { count } = await this.prisma.scholarshipGrant.updateMany({ where: { id }, data: { status, disbursedOn: status === 'disbursed' ? new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z') : null } });
    if (!count) throw new NotFoundException('Grant not found');
    return { id, status };
  }

  grants(programId?: string, schoolId?: string) {
    return this.prisma.scholarshipGrant.findMany({ where: { ...(programId && { programId }), ...(schoolId && { schoolId }) }, orderBy: { createdAt: 'desc' }, take: 500, include: { school: { select: { id: true, name: true } }, program: { select: { id: true, title: true, currency: true } } } }).then((rows) => rows.map((g) => ({ ...g, amount: n(g.amount) })));
  }

  // --- Overview and the schools -----------------------------------------------------------------------

  async overview() {
    const [programs, offers, requests, grants, schools, openOpps] = await Promise.all([
      this.prisma.scholarshipProgram.groupBy({ by: ['status'], _count: true }),
      this.prisma.scholarshipOffer.groupBy({ by: ['status'], _count: true }),
      this.prisma.scholarshipRequest.groupBy({ by: ['status'], _count: true, _sum: { studentsRequested: true } }),
      this.prisma.scholarshipGrant.groupBy({ by: ['status'], _count: true, _sum: { amount: true } }),
      this.prisma.school.count({ where: { status: 'active' } }),
      this.prisma.schoolOpportunity.count({ where: { status: 'new' } }),
    ]);
    const p = (s: string) => programs.find((x) => x.status === s)?._count ?? 0;
    const g = (s: string) => ({ students: grants.find((x) => x.status === s)?._count ?? 0, amount: n(grants.find((x) => x.status === s)?._sum.amount) });
    const live = grants.filter((x) => x.status !== 'cancelled');
    return {
      programs: { live: p('live'), recruiting: p('recruiting'), draft: p('draft'), closed: p('closed') },
      offers: { sent: offers.find((x) => x.status === 'sent')?._count ?? 0, viewed: offers.find((x) => x.status === 'viewed')?._count ?? 0, submitted: offers.find((x) => x.status === 'submitted')?._count ?? 0, declined: offers.find((x) => x.status === 'declined')?._count ?? 0 },
      requests: { waiting: requests.find((x) => x.status === 'submitted')?._count ?? 0, approved: requests.find((x) => x.status === 'approved')?._count ?? 0, rejected: requests.find((x) => x.status === 'rejected')?._count ?? 0 },
      children: { total: live.reduce((s, x) => s + x._count, 0), pledged: g('pledged').students, disbursed: g('disbursed').students },
      money: { committed: live.reduce((s, x) => s + n(x._sum.amount), 0), pledged: g('pledged').amount, disbursed: g('disbursed').amount },
      activeSchools: schools,
      newOpportunities: openOpps,
    };
  }

  /** Every active school with its size and finances, and what sponsorship it has had. */
  async schools() {
    const [schools, grants, regs, offers, subs] = await Promise.all([
      this.prisma.school.findMany({ where: { status: 'active' }, select: { id: true, name: true, slug: true, createdAt: true }, orderBy: { name: 'asc' } }),
      this.prisma.scholarshipGrant.groupBy({ by: ['schoolId'], where: { status: { not: 'cancelled' } }, _count: true, _sum: { amount: true } }),
      this.prisma.schoolRegistration.findMany({ where: { status: 'approved', schoolId: { not: null } }, select: { schoolId: true, city: true, province: true } }),
      this.prisma.scholarshipOffer.groupBy({ by: ['schoolId'], _count: true }),
      this.prisma.subscription.findMany({ where: { status: { in: ['trialing', 'active', 'past_due'] } }, select: { schoolId: true, status: true } }),
    ]);
    const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const now = new Date();
    const rows = [];
    for (let i = 0; i < schools.length; i += 6) {
      rows.push(...(await Promise.all(schools.slice(i, i + 6).map(async (s) => {
        const snap = await schoolSnapshot(this.prisma, s.id, yearStart, now);
        const grant = grants.find((x) => x.schoolId === s.id);
        const reg = regs.find((x) => x.schoolId === s.id);
        return { id: s.id, name: s.name, slug: s.slug, city: reg?.city ?? null, province: reg?.province ?? null, plan: subs.find((x) => x.schoolId === s.id)?.status ?? 'none', ...snap, scholarshipChildren: grant?._count ?? 0, scholarshipAmount: n(grant?._sum.amount), offers: offers.find((x) => x.schoolId === s.id)?._count ?? 0 };
      }))));
    }
    return rows;
  }

  private async must<T>(p: Promise<T | null>, what: string): Promise<T> {
    const v = await p;
    if (!v) throw new NotFoundException(`${what} not found`);
    return v;
  }
}
