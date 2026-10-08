import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type { CreateCampusDto, UpdateCampusDto } from './campus.dto.js';

const LIVE_STATUSES = ['trialing', 'active', 'past_due'] as const;

/** Campuses of the current school. Active campuses count against the tier's max_campuses. */
@Injectable()
export class CampusesService {
  constructor(private readonly prisma: PrismaService) {}

  list(schoolId: string) {
    return this.prisma.forSchool(schoolId).campus.findMany({
      orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
    });
  }

  create(schoolId: string, dto: CreateCampusDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await this.assertCampusCapacity(tx, schoolId);
      return tx.campus.create({ data: { schoolId, ...dto, isMain: false } });
    });
  }

  update(schoolId: string, id: string, dto: UpdateCampusDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const campus = await tx.campus.findUnique({ where: { id } });
      if (!campus) throw new NotFoundException('Campus not found');

      if (dto.isActive === false && campus.isMain) {
        throw new BadRequestException('The main campus cannot be deactivated');
      }
      if (dto.isActive === true && !campus.isActive) {
        await this.assertCampusCapacity(tx, schoolId);
      }
      return tx.campus.update({ where: { id }, data: dto });
    });
  }

  /**
   * Serializes capacity checks per school with a transaction-scoped advisory lock,
   * so two concurrent requests cannot both pass the limit.
   */
  private async assertCampusCapacity(tx: TenantTx, schoolId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'campus-capacity:' + schoolId}, 0))`;

    const subscription = await tx.subscription.findFirst({
      where: { schoolId, status: { in: [...LIVE_STATUSES] } },
      select: { tier: { select: { name: true, maxCampuses: true } } },
    });
    if (!subscription) throw new ForbiddenException('The school has no active subscription');

    const limit = subscription.tier.maxCampuses;
    if (limit === null) return;
    const active = await tx.campus.count({ where: { isActive: true } });
    if (active >= limit) {
      throw new ForbiddenException(
        `The ${subscription.tier.name} plan allows ${limit} active campus${limit === 1 ? '' : 'es'}. Upgrade to add more.`,
      );
    }
  }
}
