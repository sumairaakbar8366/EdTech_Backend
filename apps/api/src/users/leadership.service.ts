import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DASHBOARD_SECTION_KEYS, FEATURE_INFO, LEADERSHIP_TITLES, type DashboardSection } from '@schoolerp/shared';
import { AccountsService, handover } from '../accounts/accounts.service.js';
import { AuthService } from '../auth/auth.service.js';
import { VerificationCodesService } from '../auth/verification-codes.service.js';
import { SubscriptionStateService } from '../billing/subscription-state.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { closeTenure, ensureLeaderRecord } from '../staff/leader-record.js';
import type { AddLeaderDto, UpdateLeaderDto } from './leadership.dto.js';

const SEAT_USER = { select: { id: true, firstName: true, lastName: true, email: true, loginId: true, status: true, lastLoginAt: true, mustChangePassword: true } } as const;

/**
 * Leadership seats. The school admin gives the principal (every plan) and, on plans with
 * `leadership_roles`, a director, vice principal or other senior title a login in one step: the
 * person's own email is verified with a code, then their User ID and a strong one-time password go
 * to it, and the first sign-in must replace that password. Every seat works in the principal's area;
 * the admin chooses the title and which parts of the dashboard it shows, and can change both later.
 */
@Injectable()
export class LeadershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly codes: VerificationCodesService,
    private readonly auth: AuthService,
    private readonly plan: SubscriptionStateService,
  ) {}

  async overview(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [seats, principals, state] = await Promise.all([
      db.leadershipSeat.findMany({ include: { user: SEAT_USER }, orderBy: { createdAt: 'asc' } }),
      db.userRole.findMany({ where: { role: { key: 'principal' } }, select: { user: SEAT_USER } }),
      this.plan.get(schoolId),
    ]);
    const seated = new Set(seats.map((s) => s.userId));
    const rows = [
      // A principal made before seats existed still shows up (and becomes a seat when edited).
      ...principals.filter((p) => !seated.has(p.user.id)).map((p) => ({ userId: p.user.id, titleKey: 'principal', titleLabel: 'Principal', hiddenSections: [] as string[], user: p.user })),
      ...seats,
    ];
    return {
      seats: rows.map((s) => ({ userId: s.userId, titleKey: s.titleKey, titleLabel: s.titleLabel, hiddenSections: s.hiddenSections, user: s.user })),
      titles: LEADERSHIP_TITLES,
      moreTitlesIncluded: state.features.includes('leadership_roles'),
    };
  }

  private label(titleKey: string, custom?: string | null) {
    const t = LEADERSHIP_TITLES.find((x) => x.key === titleKey);
    if (!t) throw new BadRequestException('Unknown title');
    if (titleKey === 'custom') {
      const c = custom?.trim();
      if (!c) throw new BadRequestException('Type the title for this role');
      return c;
    }
    return t.label;
  }

  private sections(list: string[] | undefined, titleKey: string): DashboardSection[] {
    if (!list) return [...(LEADERSHIP_TITLES.find((t) => t.key === titleKey)?.hidden ?? [])];
    return list.filter((k): k is DashboardSection => (DASHBOARD_SECTION_KEYS as readonly string[]).includes(k));
  }

  private async assertAllowed(schoolId: string, titleKey: string) {
    if (titleKey === 'principal') return;
    const state = await this.plan.get(schoolId);
    if (!state.features.includes('leadership_roles')) {
      throw new HttpException(
        { statusCode: HttpStatus.PAYMENT_REQUIRED, error: 'Payment Required', code: 'FEATURE_NOT_IN_PLAN', message: `${FEATURE_INFO.leadership_roles.label} is not included in your plan. Upgrade to add it.`, feature: 'leadership_roles' },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  async add(schoolId: string, actorId: string, dto: AddLeaderDto) {
    const titleLabel = this.label(dto.titleKey, dto.customTitle);
    await this.assertAllowed(schoolId, dto.titleKey);
    // Same proof as every other login: the code the person received at their own email.
    const verified = dto.verification ? await this.codes.verify(dto.verification.verificationId, `admin:${schoolId}:${actorId}`, dto.verification.code) : null;
    if (verified && verified !== dto.email) throw new BadRequestException('The code was sent to a different email address');
    const hidden = this.sections(dto.hiddenSections, dto.titleKey);
    const login = await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      if (dto.titleKey === 'principal') {
        const has = await tx.userRole.count({ where: { role: { key: 'principal' }, user: { status: 'active' } } });
        if (has) throw new ConflictException('This school already has a principal. Edit or remove that seat first.');
      }
      const created = await this.accounts.createLogin(tx, schoolId, { firstName: dto.firstName, lastName: dto.lastName, email: dto.email, emailVerified: !!verified }, ['principal']);
      await ensureLeaderRecord(tx, schoolId, created.userId, 'principal');
      await tx.leadershipSeat.create({ data: { schoolId, userId: created.userId, titleKey: dto.titleKey, titleLabel, hiddenSections: hidden, createdBy: actorId } });
      return created;
    });
    await this.accounts.announce(schoolId, [login]);
    return { credentials: handover(login), titleLabel, emailedPassword: !!verified };
  }

  async update(schoolId: string, userId: string, dto: UpdateLeaderDto) {
    await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const isPrincipal = await tx.userRole.count({ where: { userId, role: { key: 'principal' } } });
      if (!isPrincipal) throw new NotFoundException('This person has no leadership seat');
      const existing = await tx.leadershipSeat.findUnique({ where: { userId } });
      const titleKey = dto.titleKey ?? existing?.titleKey ?? 'principal';
      if (titleKey !== (existing?.titleKey ?? 'principal')) await this.assertAllowed(schoolId, titleKey);
      const titleLabel = this.label(titleKey, dto.customTitle ?? (titleKey === 'custom' ? existing?.titleLabel : null));
      const hiddenSections = this.sections(dto.hiddenSections ?? existing?.hiddenSections, titleKey);
      await tx.leadershipSeat.upsert({
        where: { userId },
        create: { schoolId, userId, titleKey, titleLabel, hiddenSections },
        update: { titleKey, titleLabel, hiddenSections },
      });
    });
    return this.overview(schoolId);
  }

  /** Takes the seat away: the principal role ends (service record closed) and the login is switched off. */
  async remove(schoolId: string, actorId: string, userId: string) {
    if (userId === actorId) throw new BadRequestException('You cannot remove your own login');
    await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const roles = await tx.userRole.findMany({ where: { userId }, select: { role: { select: { key: true, id: true } } } });
      const principal = roles.find((r) => r.role.key === 'principal');
      if (!principal) throw new NotFoundException('This person has no leadership seat');
      await closeTenure(tx, schoolId, userId, { action: 'role_removed', role: 'principal', endedByUserId: actorId });
      await tx.userRole.deleteMany({ where: { userId, roleId: principal.role.id } });
      await tx.leadershipSeat.deleteMany({ where: { userId } });
      if (roles.length === 1) await tx.user.update({ where: { id: userId }, data: { status: 'disabled' } });
    });
    await this.auth.endSessions(schoolId, userId);
    return this.overview(schoolId);
  }
}
