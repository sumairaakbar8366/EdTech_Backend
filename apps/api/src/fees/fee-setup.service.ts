import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { toDateOnly } from '../common/date-only.js';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type { AssignStructureDto, AwardDto, CategoryDto, ConcessionDto, StructureDto } from './fees.dto.js';

const STRUCTURE_INCLUDE = {
  academicYear: { select: { id: true, name: true } },
  schoolClass: { select: { id: true, name: true, level: true } },
  items: { include: { category: { select: { id: true, name: true, code: true } } }, orderBy: { frequency: 'asc' as const } },
  _count: { select: { assignments: true } },
} as const;

/** Fee categories, class fee structures, student assignments and concessions (page 8). */
@Injectable()
export class FeeSetupService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Categories ---------------------------------------------------------------------

  listCategories(schoolId: string) {
    return this.prisma.forSchool(schoolId).feeCategory.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  }

  createCategory(schoolId: string, dto: CategoryDto) {
    return this.prisma.forSchool(schoolId).feeCategory.create({ data: { schoolId, ...dto } });
  }

  async updateCategory(schoolId: string, id: string, dto: CategoryDto) {
    const db = this.prisma.forSchool(schoolId);
    if (!(await db.feeCategory.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Fee category not found');
    return db.feeCategory.update({ where: { id }, data: dto });
  }

  // --- Structures ---------------------------------------------------------------------

  async listStructures(schoolId: string, academicYearId?: string) {
    const db = this.prisma.forSchool(schoolId);
    const yearId = academicYearId ?? (await db.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } }))?.id;
    return db.feeStructure.findMany({
      where: { academicYearId: yearId },
      include: STRUCTURE_INCLUDE,
      orderBy: [{ schoolClass: { level: 'asc' } }, { name: 'asc' }],
    });
  }

  createStructure(schoolId: string, dto: StructureDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const yearId = await resolveYear(tx, dto.academicYearId);
      await assertItems(tx, dto);
      if (!(await tx.schoolClass.findUnique({ where: { id: dto.classId }, select: { id: true } }))) throw new NotFoundException('Class not found');
      const structure = await tx.feeStructure.create({
        data: { schoolId, academicYearId: yearId, classId: dto.classId, name: dto.name, isActive: dto.isActive ?? true },
      });
      await tx.feeStructureItem.createMany({ data: dto.items.map((i) => ({ schoolId, structureId: structure.id, ...i })) });
      return tx.feeStructure.findUnique({ where: { id: structure.id }, include: STRUCTURE_INCLUDE });
    });
  }

  /** Replaces name/status/items. Invoices already issued keep their own copied amounts. */
  updateStructure(schoolId: string, id: string, dto: StructureDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const current = await tx.feeStructure.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Fee structure not found');
      if (dto.classId !== current.classId) throw new BadRequestException('The class of a fee structure cannot be changed');
      await assertItems(tx, dto);
      await tx.feeStructure.update({ where: { id }, data: { name: dto.name, isActive: dto.isActive ?? current.isActive } });
      await tx.feeStructureItem.deleteMany({ where: { structureId: id } });
      await tx.feeStructureItem.createMany({ data: dto.items.map((i) => ({ schoolId, structureId: id, ...i })) });
      return tx.feeStructure.findUnique({ where: { id }, include: STRUCTURE_INCLUDE });
    });
  }

  /** Assigns a structure to chosen students, or to every enrolled student of its class. */
  assign(schoolId: string, structureId: string, dto: AssignStructureDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const structure = await tx.feeStructure.findUnique({ where: { id: structureId } });
      if (!structure) throw new NotFoundException('Fee structure not found');
      if (!structure.isActive) throw new BadRequestException('This fee structure is inactive');
      const enrolled = await tx.studentEnrollment.findMany({
        where: {
          academicYearId: structure.academicYearId,
          section: { classId: structure.classId, ...(dto.sectionId && { id: dto.sectionId }) },
          status: 'enrolled',
          ...(dto.studentIds && { studentId: { in: dto.studentIds } }),
        },
        select: { studentId: true },
      });
      if (dto.studentIds && enrolled.length !== dto.studentIds.length) {
        throw new BadRequestException('Some students are not enrolled in this class for the structure’s academic year');
      }
      const { count } = await tx.studentFeeAssignment.createMany({
        data: enrolled.map((e) => ({ schoolId, studentId: e.studentId, structureId })),
        skipDuplicates: true,
      });
      return { assigned: count, alreadyAssigned: enrolled.length - count };
    });
  }

  async unassign(schoolId: string, structureId: string, studentId: string) {
    const { count } = await this.prisma.forSchool(schoolId).studentFeeAssignment.deleteMany({ where: { structureId, studentId } });
    if (!count) throw new NotFoundException('This student is not assigned to the structure');
  }

  // --- Concessions --------------------------------------------------------------------

  listConcessions(schoolId: string) {
    return this.prisma.forSchool(schoolId).discount.findMany({
      orderBy: [{ isActive: 'desc' }, { kind: 'asc' }, { name: 'asc' }],
      include: { category: { select: { id: true, name: true } }, _count: { select: { awards: { where: { status: 'active' } } } } },
    });
  }

  async createConcession(schoolId: string, dto: ConcessionDto) {
    const db = this.prisma.forSchool(schoolId);
    if (dto.categoryId && !(await db.feeCategory.findUnique({ where: { id: dto.categoryId }, select: { id: true } }))) throw new NotFoundException('Fee category not found');
    assertPercentage(dto);
    return db.discount.create({ data: { schoolId, ...dto, categoryId: dto.categoryId ?? null } });
  }

  async updateConcession(schoolId: string, id: string, dto: ConcessionDto) {
    const db = this.prisma.forSchool(schoolId);
    if (!(await db.discount.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException('Concession not found');
    assertPercentage(dto);
    return db.discount.update({ where: { id }, data: { ...dto, categoryId: dto.categoryId ?? null } });
  }

  listAwards(schoolId: string, studentId?: string) {
    return this.prisma.forSchool(schoolId).scholarshipAward.findMany({
      where: { studentId },
      orderBy: [{ status: 'asc' }, { validFrom: 'desc' }],
      include: {
        discount: { select: { id: true, name: true, kind: true, valueType: true, value: true, category: { select: { name: true } } } },
        student: { select: { id: true, firstName: true, lastName: true, admissionNo: true } },
        academicYear: { select: { name: true } },
      },
    });
  }

  grantAward(schoolId: string, dto: AwardDto, actorUserId: string) {
    if (dto.validUntil < dto.validFrom) throw new BadRequestException('Valid until must be on or after valid from');
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const [discount, student] = await Promise.all([
        tx.discount.findUnique({ where: { id: dto.discountId } }),
        tx.student.findUnique({ where: { id: dto.studentId }, select: { status: true } }),
      ]);
      if (!discount || !discount.isActive) throw new BadRequestException('Choose an active concession');
      if (!student) throw new NotFoundException('Student not found');
      const yearId = await resolveYear(tx, dto.academicYearId);
      const dup = await tx.scholarshipAward.findFirst({ where: { studentId: dto.studentId, discountId: dto.discountId, academicYearId: yearId, status: 'active' } });
      if (dup) throw new ConflictException('This concession is already active for the student this year');
      return tx.scholarshipAward.create({
        data: {
          schoolId,
          discountId: dto.discountId,
          studentId: dto.studentId,
          academicYearId: yearId,
          reason: dto.reason,
          approvedBy: actorUserId,
          validFrom: toDateOnly(dto.validFrom),
          validUntil: toDateOnly(dto.validUntil),
        },
      });
    });
  }

  async revokeAward(schoolId: string, id: string) {
    const db = this.prisma.forSchool(schoolId);
    const award = await db.scholarshipAward.findUnique({ where: { id }, select: { status: true } });
    if (!award) throw new NotFoundException('Award not found');
    if (award.status === 'revoked') throw new BadRequestException('Already revoked');
    return db.scholarshipAward.update({ where: { id }, data: { status: 'revoked' } });
  }
}

async function resolveYear(tx: TenantTx, academicYearId?: string): Promise<string> {
  const year = academicYearId
    ? await tx.academicYear.findUnique({ where: { id: academicYearId }, select: { id: true } })
    : await tx.academicYear.findFirst({ where: { isCurrent: true }, select: { id: true } });
  if (!year) throw new BadRequestException(academicYearId ? 'Academic year not found' : 'Set a current academic year first');
  return year.id;
}

async function assertItems(tx: TenantTx, dto: StructureDto): Promise<void> {
  const keys = dto.items.map((i) => `${i.categoryId}:${i.frequency}`);
  if (new Set(keys).size !== keys.length) throw new BadRequestException('Each category can appear once per frequency');
  if (dto.items.some((i) => Number(i.amount) <= 0)) throw new BadRequestException('Amounts must be greater than zero');
  const ids = [...new Set(dto.items.map((i) => i.categoryId))];
  const found = await tx.feeCategory.count({ where: { id: { in: ids }, isActive: true } });
  if (found !== ids.length) throw new BadRequestException('One or more fee categories do not exist or are inactive');
}

function assertPercentage(dto: ConcessionDto): void {
  if (Number(dto.value) <= 0) throw new BadRequestException('The value must be greater than zero');
  if (dto.valueType === 'percentage' && Number(dto.value) > 100) throw new BadRequestException('A percentage cannot exceed 100');
}
