import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PLAN_FEATURES_LIST, type PlanFeature } from '@schoolerp/shared';
import { Transform, Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { SubscriptionStateService } from '../../billing/subscription-state.service.js';
import { tierFeatures } from '../../billing/tier-features.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const PRICING_MODELS = ['flat', 'per_campus', 'campus_plus_students', 'custom'] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Empty input means "no limit" / "no price yet". */
const nullable = ({ value }: { value: unknown }) => (value === '' || value === undefined ? null : value);

export class UpdateTierDto {
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(60) name?: string;
  @IsOptional() @IsIn(PRICING_MODELS) pricingModel?: (typeof PRICING_MODELS)[number];
  @IsOptional() @Transform(nullable) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999_999) priceMonthly?: number | null;
  @IsOptional() @Transform(nullable) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(9_999_999_999) priceAnnual?: number | null;
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter code like PKR' }) currency?: string;
  @IsOptional() @Transform(nullable) @Type(() => Number) @IsInt() @Min(1) maxCampuses?: number | null;
  @IsOptional() @Transform(nullable) @Type(() => Number) @IsInt() @Min(1) maxStudents?: number | null;
  @IsOptional() @Transform(nullable) @Type(() => Number) @IsInt() @Min(1) maxStaff?: number | null;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(PLAN_FEATURES_LIST, { each: true }) features?: PlanFeature[];
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class CreateTierDto extends UpdateTierDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(/^[a-z][a-z0-9-]{1,29}$/, { message: 'code must be 2–30 lowercase letters, digits or hyphens, e.g. "premium"' })
  code: string;
}

export class ListTiersQuery {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(60) q?: string;
  @IsOptional() @IsIn(['all', 'active', 'inactive']) status?: 'all' | 'active' | 'inactive';
}

/**
 * Platform owner: the plan catalogue. Every plan's name, prices, currency, limits and features can be
 * set and changed later; plans can be added, hidden (kept for schools already on them) or deleted
 * while nobody has used them. Changes apply to schools on the plan right away.
 */
@Injectable()
export class TiersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: SubscriptionStateService,
  ) {}

  async list(q: ListTiersQuery) {
    const status = q.status ?? 'all';
    const tiers = await this.prisma.subscriptionTier.findMany({
      where: {
        ...(status !== 'all' && { isActive: status === 'active' }),
        ...(q.q && { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q, mode: 'insensitive' } }] }),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { entitlements: true },
    });
    const live = await this.prisma.subscription.groupBy({ by: ['tierId', 'status'], where: { status: { in: ['trialing', 'active', 'past_due'] } }, _count: true });
    const used = new Set((await this.prisma.subscription.findMany({ distinct: ['tierId'], select: { tierId: true } })).map((s) => s.tierId));
    return tiers.map(({ entitlements, ...t }) => ({
      ...t,
      features: tierFeatures({ code: t.code, entitlements }),
      schools: {
        paying: live.filter((l) => l.tierId === t.id && l.status !== 'trialing').reduce((n, l) => n + l._count, 0),
        trial: live.filter((l) => l.tierId === t.id && l.status === 'trialing').reduce((n, l) => n + l._count, 0),
      },
      canDelete: !used.has(t.id),
    }));
  }

  async create(dto: CreateTierDto) {
    if (!dto.name) throw new BadRequestException('Enter a name for the plan');
    if (await this.prisma.subscriptionTier.findUnique({ where: { code: dto.code }, select: { id: true } })) {
      throw new ConflictException(`A plan with the code "${dto.code}" already exists`);
    }
    const last = await this.prisma.subscriptionTier.aggregate({ _max: { sortOrder: true } });
    const { features, ...data } = dto;
    const tier = await this.prisma.subscriptionTier.create({
      data: {
        ...data,
        name: dto.name,
        pricingModel: dto.pricingModel ?? 'flat',
        currency: dto.currency ?? 'PKR',
        sortOrder: dto.sortOrder ?? (last._max.sortOrder ?? 0) + 1,
        entitlements: { create: (features ?? ['core']).map((featureKey) => ({ featureKey, isEnabled: true })) },
      },
    });
    return tier;
  }

  async update(id: string, dto: UpdateTierDto) {
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { id }, select: { id: true, isActive: true } });
    if (!tier) throw new NotFoundException('Plan not found');
    const { features, ...data } = dto;
    if (features && features.length === 0) throw new BadRequestException('A plan needs at least one feature');
    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionTier.update({ where: { id }, data });
      if (features) {
        // Every feature gets a row, so a plan the owner edited never falls back to the standard set.
        await tx.entitlement.deleteMany({ where: { tierId: id } });
        await tx.entitlement.createMany({ data: PLAN_FEATURES_LIST.map((featureKey) => ({ tierId: id, featureKey, isEnabled: features.includes(featureKey) })) });
      }
    });
    this.state.invalidate();
    return this.prisma.subscriptionTier.findUnique({ where: { id } });
  }

  async remove(id: string) {
    const tier = await this.prisma.subscriptionTier.findUnique({ where: { id }, select: { id: true } });
    if (!tier) throw new NotFoundException('Plan not found');
    const [subs, payments] = await Promise.all([
      this.prisma.subscription.count({ where: { tierId: id } }),
      this.prisma.subscriptionPayment.count({ where: { tierId: id } }),
    ]);
    if (subs || payments) throw new ConflictException('Schools have used this plan, so it cannot be deleted. Hide it instead; schools already on it keep it.');
    await this.prisma.subscriptionTier.delete({ where: { id } });
  }
}
