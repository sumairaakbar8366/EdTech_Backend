import { Injectable, NotFoundException } from '@nestjs/common';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { PrismaService } from '../prisma/prisma.service.js';
import { EVENT_KINDS, OpportunitiesService } from '../sponsorship/opportunities.service.js';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimOptional = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class EventDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(150) title: string;
  @IsIn(EVENT_KINDS.map((k) => k.key)) kind: string;
  @Matches(DATE) startsOn: string;
  @Transform(trimOptional) @IsOptional() @Matches(DATE) endsOn?: string;
  @Transform(trimOptional) @IsOptional() @IsString() @MaxLength(2000) description?: string;
  /** Tell Skool EdTech so it can offer a scholarship or sponsorship for it. */
  @IsBoolean() shareWithSponsors: boolean;
}

const day = (s: string) => new Date(`${s}T00:00:00Z`);

/** What is happening at the school. Shared events reach the platform's sponsorship team. */
@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  list(schoolId: string) {
    return this.prisma.forSchool(schoolId).schoolEvent.findMany({ orderBy: { startsOn: 'desc' }, take: 200 });
  }

  meta() {
    return { kinds: EVENT_KINDS };
  }

  async create(schoolId: string, userId: string, dto: EventDto) {
    const e = await this.prisma.forSchool(schoolId).schoolEvent.create({ data: { schoolId, title: dto.title, kind: dto.kind, startsOn: day(dto.startsOn), endsOn: dto.endsOn ? day(dto.endsOn) : null, description: dto.description ?? null, shareWithSponsors: dto.shareWithSponsors, createdBy: userId } });
    if (e.shareWithSponsors) await this.opportunities.fromEvent(schoolId, e);
    return e;
  }

  async update(schoolId: string, id: string, dto: EventDto) {
    const db = this.prisma.forSchool(schoolId);
    if (!(await db.schoolEvent.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Event not found');
    const e = await db.schoolEvent.update({ where: { id }, data: { title: dto.title, kind: dto.kind, startsOn: day(dto.startsOn), endsOn: dto.endsOn ? day(dto.endsOn) : null, description: dto.description ?? null, shareWithSponsors: dto.shareWithSponsors } });
    if (e.shareWithSponsors) await this.opportunities.fromEvent(schoolId, e);
    else await this.opportunities.withdraw('event', id);
    return e;
  }

  async remove(schoolId: string, id: string) {
    const { count } = await this.prisma.forSchool(schoolId).schoolEvent.deleteMany({ where: { id } });
    if (!count) throw new NotFoundException('Event not found');
    await this.opportunities.withdraw('event', id);
  }
}
