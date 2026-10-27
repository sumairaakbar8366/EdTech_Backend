import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { classify, sensitiveWhere, type ActivityLevel } from './activity.rules.js';

const PAGE_SIZE = 30;
const MAX_PAGE = 50;
const DAY = 86_400_000;

export interface ActivityQuery {
  page?: number;
  days?: number;
  level?: ActivityLevel;
  kind?: 'signin' | 'change';
  campusId?: string;
  q?: string;
}

export interface ActivityItem {
  id: string;
  kind: 'signin' | 'change' | 'platform';
  level: ActivityLevel;
  title: string;
  detail: string | null;
  actorName: string | null;
  /** Roles at sign-in time, e.g. "teacher,parent". */
  roles: string | null;
  campus: string | null;
  ip: string | null;
  /** A successful sign-in from an IP this person never signed in from before. */
  newDevice: boolean;
  /** Added by the main admin / owner when editing the entry. */
  note: string | null;
  /** The entry's title was changed by the main admin / owner. */
  edited: boolean;
  at: string;
}

/** Edit made by the main admin / owner: a new title and / or a note. */
export interface ActivityEdit {
  title?: string | null;
  note?: string | null;
}

/** "teacher,delegate_2" → "teacher, Admin 2". */
const roleLabel = (roles: string | null) =>
  roles ? roles.split(',').map((r) => (r.startsWith('delegate_') ? `Admin ${r.slice(9)}` : r === 'platform_owner' ? 'owner' : r.replace(/_/g, ' '))).join(', ') : null;

/**
 * Activity monitor: the sensitive writes from the audit log (deletions, access changes, results,
 * money) merged with sign-ins (failed ones flagged), for one school, optionally one campus.
 * Used by the school's administrators and by the platform owner.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schoolId: string, q: ActivityQuery) {
    const db = this.prisma.forSchool(schoolId);
    const page = Math.min(MAX_PAGE, Math.max(1, q.page ?? 1));
    const since = new Date(Date.now() - (q.days ?? 30) * DAY);
    const take = page * PAGE_SIZE;
    const campusUsers = q.campusId ? await this.campusUserIds(schoolId, q.campusId) : null;
    const text = q.q?.trim();

    const auditWhere: Prisma.AuditLogWhereInput = {
      AND: [
        sensitiveWhere(q.level === 'info' ? undefined : q.level),
        { createdAt: { gte: since } },
        ...(campusUsers ? [{ actorId: { in: campusUsers } }] : []),
        ...(text ? [{ OR: [{ actorName: { contains: text, mode: 'insensitive' as const } }, { path: { contains: text, mode: 'insensitive' as const } }] }] : []),
      ],
    };
    const loginWhere: Prisma.LoginEventWhereInput = {
      schoolId,
      createdAt: { gte: since },
      ...(q.level === 'critical' && { success: false }),
      ...(q.level === 'warning' && { success: true, method: 'support' }),
      ...(q.level === 'info' && { success: true, method: { not: 'support' } }),
      ...(campusUsers && { userId: { in: campusUsers } }),
      ...(text && { OR: [{ name: { contains: text, mode: 'insensitive' as const } }, { identifier: { contains: text.toLowerCase() } }, { loginId: { contains: text, mode: 'insensitive' as const } }] }),
    };
    const wantChanges = q.kind !== 'signin' && q.level !== 'info';
    const wantSignins = q.kind !== 'change';

    const [changes, signins, campuses, summary] = await Promise.all([
      wantChanges ? db.auditLog.findMany({ where: auditWhere, orderBy: { createdAt: 'desc' }, take }) : [],
      wantSignins ? this.prisma.loginEvent.findMany({ where: loginWhere, orderBy: { createdAt: 'desc' }, take }) : [],
      db.campus.findMany({ where: { isActive: true }, select: { id: true, name: true, code: true }, orderBy: [{ isMain: 'desc' }, { name: 'asc' }] }),
      this.summary(schoolId, campusUsers),
    ]);

    const merged = [
      ...changes.map((c) => ({ at: c.createdAt, userId: c.actorId, src: 'change' as const, c })),
      ...signins.map((s) => ({ at: s.createdAt, userId: s.userId, src: 'signin' as const, s })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    const rows = merged.slice((page - 1) * PAGE_SIZE, take);
    const hasMore = merged.length > take || changes.length === take || signins.length === take;

    const userIds = [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))];
    const [campusOf, seen] = await Promise.all([this.campusNames(schoolId, userIds), this.earlierDevices(rows.flatMap((r) => (r.src === 'signin' && r.s.success && r.s.userId ? [r.s] : [])))]);

    const items: ActivityItem[] = rows.map((r) => {
      if (r.src === 'change') {
        const { level, label } = classify(r.c);
        return { id: r.c.id, kind: 'change', level, title: r.c.title ?? label, detail: `${r.c.method} ${r.c.path}`, actorName: r.c.actorName, roles: null, campus: r.c.actorId ? campusOf.get(r.c.actorId) ?? null : null, ip: r.c.ip, newDevice: false, note: r.c.note, edited: !!r.c.title, at: r.c.createdAt.toISOString() };
      }
      const s = r.s;
      const support = s.method === 'support';
      const newDevice = s.success && !support && !!s.userId && !seen.has(s.id);
      const title = !s.success ? 'Failed sign-in' : support ? 'Platform support opened the school' : newDevice ? 'New sign-in (new device / network)' : 'Signed in';
      const detail = !s.success ? `${s.reason ?? 'refused'} · typed "${s.identifier}"` : s.method === 'password' ? null : `via ${s.method}`;
      return { id: s.id, kind: 'signin', level: !s.success ? 'critical' : support ? 'warning' : 'info', title: s.title ?? title, detail, actorName: s.name, roles: roleLabel(s.roles), campus: s.userId ? campusOf.get(s.userId) ?? null : null, ip: s.ip, newDevice, note: s.note, edited: !!s.title, at: s.createdAt.toISOString() };
    });

    return { items, page, pageSize: PAGE_SIZE, hasMore: hasMore && page < MAX_PAGE, campuses, summary };
  }

  /**
   * The owner team's own activity: owner sign-ins (failed ones flagged) and console changes, so the
   * main owner sees what each shared owner ("Owner 2"…) did.
   */
  async listPlatform(q: { page?: number; days?: number; q?: string }) {
    const page = Math.min(MAX_PAGE, Math.max(1, q.page ?? 1));
    const since = new Date(Date.now() - (q.days ?? 30) * DAY);
    const take = page * PAGE_SIZE;
    const text = q.q?.trim();
    const [changes, signins] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where: { createdAt: { gte: since }, ...(text && { OR: [{ actorName: { contains: text, mode: 'insensitive' as const } }, { path: { contains: text, mode: 'insensitive' as const } }] }) },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.loginEvent.findMany({
        where: { schoolId: null, roles: 'platform_owner', createdAt: { gte: since }, ...(text && { OR: [{ name: { contains: text, mode: 'insensitive' as const } }, { identifier: { contains: text.toLowerCase() } }] }) },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ]);
    // Failed owner sign-ins (wrong password, disabled account) have no role recorded; include them too.
    const failed = await this.prisma.loginEvent.findMany({ where: { schoolId: null, success: false, platformAdminId: { not: null }, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take });
    const merged = [
      ...changes.map((c) => ({ at: c.createdAt, item: { id: c.id, kind: 'platform' as const, level: (c.action === 'delete' ? 'critical' : 'warning') as ActivityLevel, title: c.title ?? `${c.action} ${c.entity}`.replace(/-/g, ' '), detail: `${c.method} ${c.path}`, actorName: c.actorName, roles: null, campus: null, ip: c.ip, newDevice: false, note: c.note, edited: !!c.title, at: c.createdAt.toISOString() } })),
      ...[...signins, ...failed.filter((f) => !signins.some((s) => s.id === f.id))].map((s) => ({
        at: s.createdAt,
        item: { id: s.id, kind: 'signin' as const, level: (s.success ? 'info' : 'critical') as ActivityLevel, title: s.title ?? (s.success ? 'Owner signed in' : 'Failed owner sign-in'), detail: s.success ? null : `${s.reason ?? 'refused'} · typed "${s.identifier}"`, actorName: s.name, roles: null, campus: null, ip: s.ip, newDevice: false, note: s.note, edited: !!s.title, at: s.createdAt.toISOString() },
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    const items = merged.slice((page - 1) * PAGE_SIZE, take).map((m) => m.item);
    return { items, page, pageSize: PAGE_SIZE, hasMore: merged.length > take && page < MAX_PAGE };
  }

  /** Main admin / owner: change an entry's title or note. `schoolId` null = an owner-console entry. */
  async edit(schoolId: string | null, kind: ActivityItem['kind'], id: string, e: ActivityEdit) {
    const data = { ...(e.title !== undefined && { title: e.title?.trim() || null }), ...(e.note !== undefined && { note: e.note?.trim() || null }) };
    const count =
      kind === 'change' && schoolId ? (await this.prisma.forSchool(schoolId).auditLog.updateMany({ where: { id }, data })).count
      : kind === 'signin' ? (await this.prisma.loginEvent.updateMany({ where: { id, schoolId }, data })).count
      : kind === 'platform' && !schoolId ? (await this.prisma.platformAuditLog.updateMany({ where: { id }, data })).count
      : 0;
    if (!count) throw new NotFoundException('Log entry not found');
    return { ok: true };
  }

  /** Main admin / owner: delete an entry. */
  async remove(schoolId: string | null, kind: ActivityItem['kind'], id: string) {
    const count =
      kind === 'change' && schoolId ? (await this.prisma.forSchool(schoolId).auditLog.deleteMany({ where: { id } })).count
      : kind === 'signin' ? (await this.prisma.loginEvent.deleteMany({ where: { id, schoolId } })).count
      : kind === 'platform' && !schoolId ? (await this.prisma.platformAuditLog.deleteMany({ where: { id } })).count
      : 0;
    if (!count) throw new NotFoundException('Log entry not found');
    return { ok: true };
  }

  /** Last 7 days at a glance, for the tiles above the list. */
  private async summary(schoolId: string, campusUsers: string[] | null) {
    const db = this.prisma.forSchool(schoolId);
    const since = new Date(Date.now() - 7 * DAY);
    const byCampus = campusUsers ? { actorId: { in: campusUsers } } : {};
    const loginBase = { schoolId, createdAt: { gte: since }, ...(campusUsers && { userId: { in: campusUsers } }) };
    const [critical, warning, signins, failed] = await Promise.all([
      db.auditLog.count({ where: { AND: [sensitiveWhere('critical'), { createdAt: { gte: since } }, byCampus] } }),
      db.auditLog.count({ where: { AND: [sensitiveWhere('warning'), { createdAt: { gte: since } }, byCampus] } }),
      this.prisma.loginEvent.count({ where: { ...loginBase, success: true } }),
      this.prisma.loginEvent.count({ where: { ...loginBase, success: false } }),
    ]);
    return { critical, warning, signins, failedSignins: failed };
  }

  /** Logins belonging to a campus: its staff, the students enrolled in its sections, and their guardians. */
  private async campusUserIds(schoolId: string, campusId: string): Promise<string[]> {
    const db = this.prisma.forSchool(schoolId);
    const [employees, students] = await Promise.all([
      db.employee.findMany({ where: { campusId, userId: { not: null } }, select: { userId: true } }),
      db.student.findMany({
        where: { enrollments: { some: { status: 'enrolled', section: { campusId } } } },
        select: { userId: true, guardians: { select: { guardian: { select: { userId: true } } } } },
      }),
    ]);
    const ids = new Set<string>();
    for (const e of employees) if (e.userId) ids.add(e.userId);
    for (const s of students) {
      if (s.userId) ids.add(s.userId);
      for (const g of s.guardians) if (g.guardian.userId) ids.add(g.guardian.userId);
    }
    return [...ids];
  }

  /** Campus name per login, for the rows on screen. */
  private async campusNames(schoolId: string, userIds: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!userIds.length) return out;
    const db = this.prisma.forSchool(schoolId);
    const enrolled = { where: { status: 'enrolled' as const }, take: 1, select: { section: { select: { campus: { select: { name: true } } } } } };
    const [employees, students, guardians] = await Promise.all([
      db.employee.findMany({ where: { userId: { in: userIds } }, select: { userId: true, campus: { select: { name: true } } } }),
      db.student.findMany({ where: { userId: { in: userIds } }, select: { userId: true, enrollments: enrolled } }),
      db.guardian.findMany({ where: { userId: { in: userIds } }, select: { userId: true, children: { take: 1, select: { student: { select: { enrollments: enrolled } } } } } }),
    ]);
    for (const g of guardians) {
      const name = g.children[0]?.student.enrollments[0]?.section.campus.name;
      if (g.userId && name) out.set(g.userId, name);
    }
    for (const s of students) {
      const name = s.enrollments[0]?.section.campus.name;
      if (s.userId && name) out.set(s.userId, name);
    }
    for (const e of employees) if (e.userId) out.set(e.userId, e.campus.name);
    return out;
  }

  /** Ids of the given successful sign-ins whose person had signed in from the same IP before. */
  private async earlierDevices(events: { id: string; userId: string | null; ip: string | null; createdAt: Date }[]): Promise<Set<string>> {
    const known = new Set<string>();
    if (!events.length) return known;
    const users = [...new Set(events.map((e) => e.userId!))];
    const latest = new Date(Math.max(...events.map((e) => e.createdAt.getTime())));
    const history = await this.prisma.loginEvent.findMany({
      where: { userId: { in: users }, success: true, createdAt: { lt: latest } },
      select: { userId: true, ip: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 5000,
    });
    for (const e of events) {
      if (history.some((h) => h.userId === e.userId && h.ip === e.ip && h.createdAt < e.createdAt)) known.add(e.id);
    }
    return known;
  }
}
