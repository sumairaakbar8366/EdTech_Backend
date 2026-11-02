import { Injectable, Logger } from '@nestjs/common';
import { OwnerAlertsService } from '../delivery/owner-alerts.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const EVENT_KINDS = [
  { key: 'admissions_open', label: 'Admissions open' },
  { key: 'science_fair', label: 'Science fair / exhibition' },
  { key: 'sports_day', label: 'Sports day' },
  { key: 'annual_function', label: 'Annual function / prize distribution' },
  { key: 'seminar', label: 'Seminar or workshop' },
  { key: 'charity', label: 'Charity or community drive' },
  { key: 'other', label: 'Other' },
] as const;

/**
 * Chances for the platform to help: a school opening admissions or planning a science fair is
 * copied here (with the school's consent) so the owner can answer with one click.
 */
@Injectable()
export class OpportunitiesService {
  private readonly log = new Logger(OpportunitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerts: OwnerAlertsService,
  ) {}

  /** Never throws: a school posting an event must not fail because the owner's list could not be updated. */
  async fromEvent(schoolId: string, e: { id: string; title: string; kind: string; startsOn: Date; description: string | null }): Promise<void> {
    await this.upsert(schoolId, { sourceType: 'event', sourceId: e.id, title: e.title, kind: e.kind, startsOn: e.startsOn, details: e.description });
  }

  async fromAdmissions(schoolId: string): Promise<void> {
    const now = new Date();
    await this.upsert(schoolId, { sourceType: 'admissions', sourceId: `${schoolId}:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`, title: 'Admissions are open', kind: 'admissions_open', startsOn: now, details: null });
  }

  async withdraw(sourceType: string, sourceId: string): Promise<void> {
    await this.prisma.schoolOpportunity.deleteMany({ where: { sourceType, sourceId, status: 'new' } }).catch(() => undefined);
  }

  private async upsert(schoolId: string, o: { sourceType: string; sourceId: string; title: string; kind: string; startsOn: Date | null; details: string | null }) {
    try {
      const existing = await this.prisma.schoolOpportunity.findUnique({ where: { sourceType_sourceId: { sourceType: o.sourceType, sourceId: o.sourceId } }, select: { id: true } });
      if (existing) {
        await this.prisma.schoolOpportunity.update({ where: { id: existing.id }, data: { title: o.title, kind: o.kind, startsOn: o.startsOn, details: o.details } });
        return;
      }
      const school = await this.prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } });
      await this.prisma.schoolOpportunity.create({ data: { schoolId, ...o } });
      await this.alerts.raise({ kind: 'sponsorship_opportunity', title: `${school?.name ?? 'A school'}: ${o.title}`, body: `A chance to offer a scholarship or sponsorship${o.startsOn ? ` (${o.startsOn.toISOString().slice(0, 10)})` : ''}.`, link: '/scholarships?tab=opportunities', schoolId });
    } catch (e) {
      this.log.error(`opportunity not recorded: ${(e as Error).message}`);
    }
  }
}
