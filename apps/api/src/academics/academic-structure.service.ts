import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService, type TenantTx } from '../prisma/prisma.service.js';
import type {
  CreateClassDto,
  CreateRoomDto,
  CreateSectionDto,
  CreateSubjectDto,
  ListSectionsQuery,
  UpdateClassDto,
  UpdateRoomDto,
  UpdateSectionDto,
  UpdateSubjectDto,
} from './academics.dto.js';

/**
 * Classes (school-wide grades), sections (a class at one campus), subjects, the subjects
 * taught per class, and rooms (per campus). Page 10 "Academic Structure".
 */
@Injectable()
export class AcademicStructureService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const [currentYear, classes, sections, subjects, rooms, campuses] = await Promise.all([
      db.academicYear.findFirst({ where: { isCurrent: true }, include: { terms: { orderBy: { startDate: 'asc' } } } }),
      db.schoolClass.count(),
      db.section.count(),
      db.subject.count(),
      db.room.count(),
      db.campus.count({ where: { isActive: true } }),
    ]);
    return { currentYear, counts: { classes, sections, subjects, rooms, campuses } };
  }

  // --- Classes ----------------------------------------------------------------

  listClasses(schoolId: string) {
    return this.prisma.forSchool(schoolId).schoolClass.findMany({
      orderBy: [{ level: 'asc' }, { name: 'asc' }],
      include: {
        sections: {
          orderBy: [{ campus: { name: 'asc' } }, { name: 'asc' }],
          include: { campus: { select: { id: true, name: true, code: true } } },
        },
        classSubjects: { include: { subject: true }, orderBy: { subject: { name: 'asc' } } },
      },
    });
  }

  createClass(schoolId: string, dto: CreateClassDto) {
    return this.prisma.forSchool(schoolId).schoolClass.create({ data: { schoolId, ...dto } });
  }

  async updateClass(schoolId: string, id: string, dto: UpdateClassDto) {
    const db = this.prisma.forSchool(schoolId);
    await mustExist(db.schoolClass.findUnique({ where: { id }, select: { id: true } }), 'Class');
    return db.schoolClass.update({ where: { id }, data: dto });
  }

  removeClass(schoolId: string, id: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await mustExist(tx.schoolClass.findUnique({ where: { id }, select: { id: true } }), 'Class');
      const sections = await tx.section.count({ where: { classId: id } });
      if (sections > 0) {
        throw new ConflictException(`This class has ${sections} section${sections === 1 ? '' : 's'}. Delete them first.`);
      }
      await tx.schoolClass.delete({ where: { id } });
    });
  }

  /** Replaces the set of subjects taught in a class. */
  setClassSubjects(schoolId: string, classId: string, subjectIds: string[]) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await mustExist(tx.schoolClass.findUnique({ where: { id: classId }, select: { id: true } }), 'Class');
      const found = await tx.subject.count({ where: { id: { in: subjectIds } } });
      if (found !== subjectIds.length) throw new BadRequestException('One or more subjects do not exist');
      await tx.classSubject.deleteMany({ where: { classId } });
      if (subjectIds.length > 0) {
        await tx.classSubject.createMany({ data: subjectIds.map((subjectId) => ({ classId, subjectId, schoolId })) });
      }
      return tx.classSubject.findMany({ where: { classId }, include: { subject: true } });
    });
  }

  // --- Sections -----------------------------------------------------------------

  listSections(schoolId: string, query: ListSectionsQuery) {
    return this.prisma.forSchool(schoolId).section.findMany({
      where: { classId: query.classId, campusId: query.campusId },
      orderBy: [{ schoolClass: { level: 'asc' } }, { name: 'asc' }],
      include: {
        schoolClass: { select: { id: true, name: true, level: true } },
        campus: { select: { id: true, name: true, code: true } },
      },
    });
  }

  createSection(schoolId: string, dto: CreateSectionDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await mustExist(tx.schoolClass.findUnique({ where: { id: dto.classId }, select: { id: true } }), 'Class');
      await assertActiveCampus(tx, dto.campusId);
      return tx.section.create({ data: { schoolId, ...dto } });
    });
  }

  updateSection(schoolId: string, id: string, dto: UpdateSectionDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await mustExist(tx.section.findUnique({ where: { id }, select: { id: true } }), 'Section');
      if (dto.campusId) await assertActiveCampus(tx, dto.campusId);
      return tx.section.update({ where: { id }, data: dto });
    });
  }

  async removeSection(schoolId: string, id: string) {
    const db = this.prisma.forSchool(schoolId);
    await mustExist(db.section.findUnique({ where: { id }, select: { id: true } }), 'Section');
    await db.section.delete({ where: { id } });
  }

  // --- Subjects -----------------------------------------------------------------

  listSubjects(schoolId: string) {
    return this.prisma.forSchool(schoolId).subject.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { classSubjects: true } } },
    });
  }

  createSubject(schoolId: string, dto: CreateSubjectDto) {
    return this.prisma.forSchool(schoolId).subject.create({ data: { schoolId, ...dto } });
  }

  async updateSubject(schoolId: string, id: string, dto: UpdateSubjectDto) {
    const db = this.prisma.forSchool(schoolId);
    await mustExist(db.subject.findUnique({ where: { id }, select: { id: true } }), 'Subject');
    return db.subject.update({ where: { id }, data: dto });
  }

  removeSubject(schoolId: string, id: string) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await mustExist(tx.subject.findUnique({ where: { id }, select: { id: true } }), 'Subject');
      const used = await tx.classSubject.count({ where: { subjectId: id } });
      if (used > 0) {
        throw new ConflictException(`This subject is taught in ${used} class${used === 1 ? '' : 'es'}. Remove it from them first.`);
      }
      await tx.subject.delete({ where: { id } });
    });
  }

  // --- Rooms --------------------------------------------------------------------

  listRooms(schoolId: string) {
    return this.prisma.forSchool(schoolId).room.findMany({
      orderBy: [{ campus: { name: 'asc' } }, { name: 'asc' }],
      include: { campus: { select: { id: true, name: true, code: true } } },
    });
  }

  createRoom(schoolId: string, dto: CreateRoomDto) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      await assertActiveCampus(tx, dto.campusId);
      return tx.room.create({ data: { schoolId, ...dto } });
    });
  }

  async updateRoom(schoolId: string, id: string, dto: UpdateRoomDto) {
    const db = this.prisma.forSchool(schoolId);
    await mustExist(db.room.findUnique({ where: { id }, select: { id: true } }), 'Room');
    return db.room.update({ where: { id }, data: dto });
  }

  async removeRoom(schoolId: string, id: string) {
    const db = this.prisma.forSchool(schoolId);
    await mustExist(db.room.findUnique({ where: { id }, select: { id: true } }), 'Room');
    await db.room.delete({ where: { id } });
  }
}

async function mustExist<T>(lookup: Promise<T | null>, label: string): Promise<T> {
  const row = await lookup;
  if (!row) throw new NotFoundException(`${label} not found`);
  return row;
}

async function assertActiveCampus(tx: TenantTx, campusId: string): Promise<void> {
  const campus = await tx.campus.findUnique({ where: { id: campusId }, select: { isActive: true } });
  if (!campus) throw new NotFoundException('Campus not found');
  if (!campus.isActive) throw new BadRequestException('This campus is inactive');
}
