import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { formatDateOnly, toDateOnly } from '../common/date-only.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type {
  CreateAcademicYearDto,
  CreateTermDto,
  UpdateAcademicYearDto,
  UpdateTermDto,
} from './academics.dto.js';
import { assertValidRange, rangeContains, rangesOverlap, type DateRange } from './date-rules.js';

/**
 * Academic years and terms.
 * Rules: years never overlap within a school; exactly one current year once any exist;
 * terms lie inside their year and never overlap each other. The database enforces the
 * same rules (exclusion constraints, partial unique index) as a backstop.
 */
@Injectable()
export class AcademicYearsService {
  constructor(private readonly prisma: PrismaService) {}

  list(schoolId: string) {
    return this.prisma.forSchool(schoolId).academicYear.findMany({
      orderBy: { startDate: 'desc' },
      include: { terms: { orderBy: { startDate: 'asc' } } },
    });
  }

  create(schoolId: string, dto: CreateAcademicYearDto) {
    const range = { startDate: toDateOnly(dto.startDate), endDate: toDateOnly(dto.endDate) };
    assertValidRange(range, 'An academic year');

    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await lockYears(tx, schoolId);
      await this.assertNoYearOverlap(tx, range);
      const hasCurrent = (await tx.academicYear.count({ where: { isCurrent: true } })) > 0;
      const makeCurrent = dto.makeCurrent === true || !hasCurrent;
      if (makeCurrent) await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      return tx.academicYear.create({
        data: { schoolId, name: dto.name, ...range, isCurrent: makeCurrent },
        include: { terms: true },
      });
    });
  }

  update(schoolId: string, id: string, dto: UpdateAcademicYearDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await lockYears(tx, schoolId);
      const year = await tx.academicYear.findUnique({ where: { id }, include: { terms: true } });
      if (!year) throw new NotFoundException('Academic year not found');

      const range = {
        startDate: dto.startDate ? toDateOnly(dto.startDate) : year.startDate,
        endDate: dto.endDate ? toDateOnly(dto.endDate) : year.endDate,
      };
      assertValidRange(range, 'An academic year');
      await this.assertNoYearOverlap(tx, range, id);
      const outside = year.terms.find((t) => !rangeContains(range, t));
      if (outside) {
        throw new BadRequestException(`Term "${outside.name}" would fall outside the new dates. Adjust it first.`);
      }
      return tx.academicYear.update({
        where: { id },
        data: { ...(dto.name !== undefined && { name: dto.name }), ...range },
        include: { terms: { orderBy: { startDate: 'asc' } } },
      });
    });
  }

  setCurrent(schoolId: string, id: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await lockYears(tx, schoolId);
      const year = await tx.academicYear.findUnique({ where: { id } });
      if (!year) throw new NotFoundException('Academic year not found');
      await tx.academicYear.updateMany({ where: { isCurrent: true, id: { not: id } }, data: { isCurrent: false } });
      return tx.academicYear.update({ where: { id }, data: { isCurrent: true } });
    });
  }

  remove(schoolId: string, id: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const year = await tx.academicYear.findUnique({ where: { id } });
      if (!year) throw new NotFoundException('Academic year not found');
      if (year.isCurrent) {
        throw new BadRequestException('The current academic year cannot be deleted. Make another year current first.');
      }
      await tx.academicYear.delete({ where: { id } });
    });
  }

  // --- Terms ------------------------------------------------------------------

  createTerm(schoolId: string, yearId: string, dto: CreateTermDto) {
    const range = { startDate: toDateOnly(dto.startDate), endDate: toDateOnly(dto.endDate) };
    assertValidRange(range, 'A term');
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await lockYears(tx, schoolId);
      const year = await tx.academicYear.findUnique({ where: { id: yearId } });
      if (!year) throw new NotFoundException('Academic year not found');
      await assertTermFits(tx, year, range);
      return tx.term.create({ data: { schoolId, academicYearId: yearId, name: dto.name, ...range } });
    });
  }

  updateTerm(schoolId: string, termId: string, dto: UpdateTermDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await lockYears(tx, schoolId);
      const term = await tx.term.findUnique({ where: { id: termId }, include: { academicYear: true } });
      if (!term) throw new NotFoundException('Term not found');
      const range = {
        startDate: dto.startDate ? toDateOnly(dto.startDate) : term.startDate,
        endDate: dto.endDate ? toDateOnly(dto.endDate) : term.endDate,
      };
      assertValidRange(range, 'A term');
      await assertTermFits(tx, term.academicYear, range, termId);
      return tx.term.update({
        where: { id: termId },
        data: { ...(dto.name !== undefined && { name: dto.name }), ...range },
      });
    });
  }

  async removeTerm(schoolId: string, termId: string) {
    const db = this.prisma.forSchool(schoolId);
    if (!(await db.term.findUnique({ where: { id: termId }, select: { id: true } }))) {
      throw new NotFoundException('Term not found');
    }
    await db.term.delete({ where: { id: termId } });
  }

  private async assertNoYearOverlap(tx: TenantTx, range: DateRange, excludeId?: string) {
    const clash = await tx.academicYear.findFirst({
      where: {
        ...(excludeId && { id: { not: excludeId } }),
        startDate: { lte: range.endDate },
        endDate: { gte: range.startDate },
      },
    });
    if (clash) {
      throw new ConflictException(
        `Dates overlap academic year "${clash.name}" (${formatDateOnly(clash.startDate)} to ${formatDateOnly(clash.endDate)})`,
      );
    }
  }
}

/** Serializes year/term changes per school so overlap checks cannot race. */
async function lockYears(tx: TenantTx, schoolId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'academic-years:' + schoolId}, 0))`;
}

async function assertTermFits(
  tx: TenantTx,
  year: DateRange & { id: string; name: string },
  range: DateRange,
  excludeTermId?: string,
): Promise<void> {
  if (!rangeContains(year, range)) {
    throw new BadRequestException(
      `A term must fall within ${year.name} (${formatDateOnly(year.startDate)} to ${formatDateOnly(year.endDate)})`,
    );
  }
  const siblings = await tx.term.findMany({
    where: { academicYearId: year.id, ...(excludeTermId && { id: { not: excludeTermId } }) },
  });
  const clash = siblings.find((t) => rangesOverlap(t, range));
  if (clash) throw new ConflictException(`Dates overlap term "${clash.name}"`);
}
