import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, PayloadTooLargeException, type OnApplicationBootstrap } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { NotificationsService } from '../communication/notifications.service.js';
import { detectAllowedType } from '../documents/file-type.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { approverIds } from '../rbac/approvers.js';
import { RedisService } from '../redis/redis.service.js';
import { StorageService } from '../storage/storage.service.js';

const MAX_BYTES = 3 * 1024 * 1024;
/** An uploaded picture waits this long to be used by a form (application, profile) before it is ignored. */
const STAGED_TTL_SECONDS = 6 * 3600;
const stagedKey = (schoolId: string, id: string) => `schoolerp:photo-staged:${schoolId}:${id}`;
/** Two pictures whose difference hashes differ in at most this many of 64 bits are the same picture. */
const SIMILAR_BITS = 6;

/** SHA-256 (exact file) and a 64-bit difference hash (same picture resized, re-saved or lightly edited). */
async function fingerprint(data: Buffer): Promise<{ sha256: string; dhash: string }> {
  const sha256 = createHash('sha256').update(data).digest('hex');
  const px = await sharp(data).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (px[y * 9 + x]! > px[y * 9 + x + 1]! ? 1n : 0n);
  return { sha256, dhash: bits.toString(16).padStart(16, '0') };
}

function distance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** Pictures in use, with whose they are (students, staff, parents, logins, applications, pending requests). */
const IN_USE_SQL = `
  SELECT photo_key::text AS key, first_name || ' ' || last_name AS name, 'student' AS kind FROM students WHERE photo_key IS NOT NULL
  UNION ALL SELECT photo_key::text, first_name || ' ' || last_name, 'staff member' FROM employees WHERE photo_key IS NOT NULL
  UNION ALL SELECT photo_key::text, first_name || ' ' || last_name, 'parent' FROM guardians WHERE photo_key IS NOT NULL
  UNION ALL SELECT photo_key::text, first_name || ' ' || last_name, 'login' FROM users WHERE photo_key IS NOT NULL
  UNION ALL SELECT photo_key::text, first_name || ' ' || last_name, 'admission applicant' FROM admission_applications WHERE photo_key IS NOT NULL AND status NOT IN ('rejected', 'withdrawn')
  UNION ALL SELECT photo_key::text, first_name || ' ' || last_name, 'job applicant' FROM job_applications WHERE photo_key IS NOT NULL AND status NOT IN ('rejected', 'withdrawn')
  UNION ALL SELECT r.photo_key::text, 'a pending picture request', 'request' FROM photo_change_requests r WHERE r.status = 'pending'`;

export type PhotoSubject = 'student' | 'employee' | 'guardian' | 'user';
type Auth = { schoolId: string; userId: string };

/**
 * Profile pictures of students, staff, parents and logins. A picture is uploaded first ("staged")
 * and then attached to a record by the form that uses it. Students and staff who already have a
 * picture ask the admin to change it; parents, admins and the principal change their own directly.
 * Pictures are only served to signed-in people of the same school.
 */
@Injectable()
export class PhotosService implements OnApplicationBootstrap {
  private readonly log = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Stores an uploaded picture and returns its id for a form to attach. A picture that is already on
   * someone's profile (the same file, or the same picture resized / re-saved) is refused. `publicForm`:
   * the school website, where the other person's name is not shown.
   */
  async stage(schoolId: string, file: Express.Multer.File, publicForm = false) {
    if (file.size > MAX_BYTES) throw new PayloadTooLargeException('The picture must be at most 3 MB');
    if (!detectAllowedType(file.originalname, file.buffer, ['image/png', 'image/jpeg'])) throw new BadRequestException('The picture must be a JPG or PNG image');
    let print: { sha256: string; dhash: string };
    try {
      print = await fingerprint(file.buffer);
    } catch {
      throw new BadRequestException('This picture could not be read; please choose another JPG or PNG');
    }
    const owner = await this.findOwnerOfSame(schoolId, print);
    if (owner) {
      throw new ConflictException(
        publicForm
          ? 'This photo has already been used. Please upload a clear, recent photo of the applicant.'
          : `This picture is already used for ${owner.name} (${owner.kind}). Every person needs their own photo.`,
      );
    }
    const id = randomUUID();
    await this.storage.put(`${schoolId}/${id}`, file.buffer);
    await this.prisma.forSchool(schoolId).photoFingerprint.create({ data: { photoKey: id, schoolId, ...print } });
    await this.redis.set(stagedKey(schoolId, id), '1', 'EX', STAGED_TTL_SECONDS);
    return { photoId: id };
  }

  /** Whose profile already has this picture (or a near-identical one), if anyone's. */
  private async findOwnerOfSame(schoolId: string, print: { sha256: string; dhash: string }) {
    return this.prisma.inSchoolTransaction(schoolId, async (tx) => {
      const used = await tx.$queryRawUnsafe<{ key: string; name: string; kind: string }[]>(IN_USE_SQL);
      if (!used.length) return null;
      const prints = await tx.photoFingerprint.findMany({ where: { photoKey: { in: [...new Set(used.map((u) => u.key))] } }, select: { photoKey: true, sha256: true, dhash: true } });
      const match = prints.find((p) => p.sha256 === print.sha256 || distance(p.dhash, print.dhash) <= SIMILAR_BITS);
      return match ? used.find((u) => u.key === match.photoKey)! : null;
    });
  }

  /** Removes a picture that is no longer used, with its fingerprint. */
  private async discard(schoolId: string, key: string) {
    await this.storage.delete(`${schoolId}/${key}`);
    await this.prisma.forSchool(schoolId).photoFingerprint.deleteMany({ where: { photoKey: key } });
  }

  /**
   * On start: pictures added before fingerprints were kept get one, and pictures used for more than
   * one person are reported in the log (they are left in place for the admin to fix).
   */
  async onApplicationBootstrap() {
    try {
      const schools = await this.prisma.school.findMany({ select: { id: true } });
      for (const { id: schoolId } of schools) {
        const used = await this.prisma.inSchoolTransaction(schoolId, (tx) => tx.$queryRawUnsafe<{ key: string; name: string; kind: string }[]>(IN_USE_SQL));
        const have = new Set((await this.prisma.forSchool(schoolId).photoFingerprint.findMany({ select: { photoKey: true } })).map((p) => p.photoKey));
        for (const key of new Set(used.map((u) => u.key))) {
          if (have.has(key)) continue;
          try {
            const chunks: Buffer[] = [];
            for await (const c of this.storage.read(`${schoolId}/${key}`)) chunks.push(c as Buffer);
            await this.prisma.forSchool(schoolId).photoFingerprint.create({ data: { photoKey: key, schoolId, ...(await fingerprint(Buffer.concat(chunks))) } });
          } catch (e) {
            this.log.warn(`no fingerprint for picture ${key}: ${(e as Error).message}`);
          }
        }
        const prints = await this.prisma.forSchool(schoolId).photoFingerprint.findMany({ where: { photoKey: { in: used.map((u) => u.key) } } });
        for (let i = 0; i < prints.length; i++) {
          for (let j = i + 1; j < prints.length; j++) {
            const [a, b] = [prints[i]!, prints[j]!];
            if (a.sha256 === b.sha256 || distance(a.dhash, b.dhash) <= SIMILAR_BITS) {
              const who = (k: string) => used.filter((u) => u.key === k).map((u) => `${u.name} (${u.kind})`).join(', ');
              this.log.warn(`same picture used twice in school ${schoolId}: ${who(a.photoKey)} and ${who(b.photoKey)}`);
            }
          }
        }
      }
    } catch (e) {
      this.log.error(`picture fingerprints failed: ${(e as Error).message}`);
    }
  }

  /** Takes a staged picture for a record (once). */
  async claim(schoolId: string, photoId: string): Promise<string> {
    const taken = await this.redis.del(stagedKey(schoolId, photoId));
    if (!taken) throw new BadRequestException('The picture upload has expired; please choose the picture again');
    return photoId;
  }

  /** Streams a picture when it belongs to someone in the school. */
  async open(schoolId: string, id: string) {
    const known = await this.prisma.inSchoolTransaction(schoolId, (tx) => tx.$queryRaw<{ n: number }[]>`
      SELECT 1 AS n FROM students WHERE photo_key = ${id}::uuid
      UNION ALL SELECT 1 FROM employees WHERE photo_key = ${id}::uuid
      UNION ALL SELECT 1 FROM guardians WHERE photo_key = ${id}::uuid
      UNION ALL SELECT 1 FROM users WHERE photo_key = ${id}::uuid
      UNION ALL SELECT 1 FROM admission_applications WHERE photo_key = ${id}::uuid
      UNION ALL SELECT 1 FROM job_applications WHERE photo_key = ${id}::uuid
      UNION ALL SELECT 1 FROM photo_change_requests WHERE photo_key = ${id}::uuid
      LIMIT 1`);
    if (!known.length) throw new NotFoundException('Picture not found');
    return this.storage.read(`${schoolId}/${id}`);
  }

  /** Admin (or the office) sets someone's picture directly. */
  async setFor(schoolId: string, subject: PhotoSubject, subjectId: string, photoId: string) {
    const key = await this.claim(schoolId, photoId);
    const previous = await this.replace(schoolId, subject, subjectId, key);
    if (previous && previous !== key) await this.discard(schoolId, previous);
    return { photoKey: key };
  }

  /**
   * The signed-in person's own picture. Parents, admins, the principal and shared admins change it
   * at once; a student or staff member who already has one asks the admin (a change request).
   */
  async setMine(auth: Auth, photoId: string, isAdmin: boolean) {
    const db = this.prisma.forSchool(auth.schoolId);
    const user = await db.user.findUnique({
      where: { id: auth.userId },
      select: { student: { select: { id: true, photoKey: true } }, employee: { select: { id: true, photoKey: true } }, guardian: { select: { id: true } } },
    });
    if (!user) throw new NotFoundException('Login not found');
    const record = user.employee ? { subject: 'employee' as const, ...user.employee } : user.student ? { subject: 'student' as const, ...user.student } : null;

    if (record && record.photoKey && !isAdmin) {
      const key = await this.claim(auth.schoolId, photoId);
      await db.photoChangeRequest.updateMany({ where: { userId: auth.userId, status: 'pending' }, data: { status: 'rejected', note: 'Replaced by a newer request' } });
      await db.photoChangeRequest.create({ data: { schoolId: auth.schoolId, userId: auth.userId, subjectType: record.subject, subjectId: record.id, photoKey: key } });
      await this.notifications.notify(auth.schoolId, await approverIds(this.prisma, auth.schoolId), { eventType: 'photo_request', title: 'Profile picture change requested', body: 'Review it in Users & Access.', link: '/users-and-access' });
      return { status: 'requested' as const };
    }
    const target: [PhotoSubject, string] = record ? [record.subject, record.id] : user.guardian ? ['guardian', user.guardian.id] : ['user', auth.userId];
    await this.setFor(auth.schoolId, target[0], target[1], photoId);
    return { status: 'updated' as const };
  }

  async listRequests(schoolId: string) {
    const db = this.prisma.forSchool(schoolId);
    const rows = await db.photoChangeRequest.findMany({ where: { status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 100 });
    const [students, employees] = await Promise.all([
      db.student.findMany({ where: { id: { in: rows.filter((r) => r.subjectType === 'student').map((r) => r.subjectId) } }, select: { id: true, firstName: true, lastName: true, admissionNo: true, photoKey: true } }),
      db.employee.findMany({ where: { id: { in: rows.filter((r) => r.subjectType === 'employee').map((r) => r.subjectId) } }, select: { id: true, firstName: true, lastName: true, employeeNo: true, designation: true, photoKey: true } }),
    ]);
    return rows.map((r) => {
      const s = students.find((x) => x.id === r.subjectId);
      const e = employees.find((x) => x.id === r.subjectId);
      const who = s ? { name: `${s.firstName} ${s.lastName}`, detail: `Student · ${s.admissionNo}`, currentPhotoKey: s.photoKey } : e ? { name: `${e.firstName} ${e.lastName}`, detail: `${e.designation} · ${e.employeeNo}`, currentPhotoKey: e.photoKey } : { name: 'Unknown', detail: '', currentPhotoKey: null };
      return { id: r.id, subjectType: r.subjectType, newPhotoKey: r.photoKey, createdAt: r.createdAt, ...who };
    });
  }

  async decide(auth: Auth, id: string, approve: boolean, note?: string) {
    const db = this.prisma.forSchool(auth.schoolId);
    const r = await db.photoChangeRequest.findFirst({ where: { id, status: 'pending' } });
    if (!r) throw new NotFoundException('Request not found or already decided');
    if (approve) {
      const previous = await this.replace(auth.schoolId, r.subjectType as PhotoSubject, r.subjectId, r.photoKey);
      if (previous && previous !== r.photoKey) await this.discard(auth.schoolId, previous);
    }
    await db.photoChangeRequest.update({ where: { id }, data: { status: approve ? 'approved' : 'rejected', note: note ?? null, reviewedBy: auth.userId, reviewedAt: new Date() } });
    if (!approve) await this.discard(auth.schoolId, r.photoKey);
    await this.notifications.notify(auth.schoolId, [r.userId], {
      eventType: 'photo_request',
      title: approve ? 'Your new profile picture is approved' : 'Your profile picture change was not approved',
      body: note ?? (approve ? 'It now shows on your profile.' : 'Please contact the school office.'),
    });
    return { ok: true };
  }

  /** Writes the picture on the record; returns the one it replaced. */
  private async replace(schoolId: string, subject: PhotoSubject, id: string, key: string): Promise<string | null> {
    const db = this.prisma.forSchool(schoolId);
    const select = { photoKey: true } as const;
    const prev =
      subject === 'student' ? await db.student.findUnique({ where: { id }, select })
      : subject === 'employee' ? await db.employee.findUnique({ where: { id }, select })
      : subject === 'guardian' ? await db.guardian.findUnique({ where: { id }, select })
      : await db.user.findUnique({ where: { id }, select });
    if (!prev) throw new NotFoundException('Person not found');
    if (subject === 'student') await db.student.update({ where: { id }, data: { photoKey: key } });
    else if (subject === 'employee') await db.employee.update({ where: { id }, data: { photoKey: key } });
    else if (subject === 'guardian') await db.guardian.update({ where: { id }, data: { photoKey: key } });
    else await db.user.update({ where: { id }, data: { photoKey: key } });
    return prev.photoKey;
  }

  assertSchool(auth: { scope: string }): asserts auth is { scope: 'school'; schoolId: string; userId: string } {
    if (auth.scope !== 'school') throw new ForbiddenException();
  }
}
