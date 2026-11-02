import type { TenantTx } from '../prisma/prisma.service.js';
import { lock, nextEmployeeNo } from './staff.service.js';

/** Department of the staff records of administrators and principals, so the principal finds them all. */
export const ADMINISTRATION = 'Administration';
const DESIGNATION = { school_admin: 'School Administrator', principal: 'Principal' } as const;
export const LEADER_DESIGNATIONS = Object.values(DESIGNATION);

/**
 * Makes sure an administrator's or principal's login has a staff record (needed for leave, salary
 * and, when they leave, clearance by the principal). Links an existing staff record with the same
 * email, otherwise creates one in Administration. Does nothing for logins that already have one.
 * Returns the staff record id (null for the platform's hidden support login).
 */
export async function ensureLeaderRecord(tx: TenantTx, schoolId: string, userId: string, role: keyof typeof DESIGNATION): Promise<string | null> {
  const id = await ensureStaffRecord(tx, schoolId, userId, role);
  if (id) await openTenure(tx, schoolId, userId, role);
  return id;
}

async function ensureStaffRecord(tx: TenantTx, schoolId: string, userId: string, role: keyof typeof DESIGNATION): Promise<string | null> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { loginId: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true, employee: { select: { id: true } } } });
  if (!user || user.loginId.startsWith('SUP-')) return null;
  if (user.employee) return user.employee.id;
  await lock(tx, `staff:${schoolId}`);
  if (user.email) {
    const same = await tx.employee.findFirst({ where: { email: user.email, userId: null }, select: { id: true } });
    if (same) {
      await tx.employee.update({ where: { id: same.id }, data: { userId } });
      return same.id;
    }
  }
  const campus = (await tx.campus.findFirst({ where: { isMain: true }, select: { id: true } })) ?? (await tx.campus.findFirst({ where: { isActive: true }, select: { id: true } }));
  if (!campus) return null;
  const employee = await tx.employee.create({
    data: {
      schoolId,
      campusId: campus.id,
      userId,
      employeeNo: await nextEmployeeNo(tx),
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      staffType: 'non_teaching',
      designation: DESIGNATION[role],
      department: ADMINISTRATION,
      employmentType: 'full_time',
      joinDate: new Date(user.createdAt.toISOString().slice(0, 10)),
    },
    select: { id: true },
  });
  await tx.employeeStatusHistory.create({ data: { schoolId, employeeId: employee.id, fromStatus: null, toStatus: 'active', reason: `${DESIGNATION[role]} record`, changedBy: null } });
  return employee.id;
}

export type LeaderRole = keyof typeof DESIGNATION;
export type TenureEnd = 'suspended' | 'resigned' | 'terminated' | 'role_removed';

/** Starts a School Admin / Principal period for the login, unless one is already open. */
export async function openTenure(tx: TenantTx, schoolId: string, userId: string, role: LeaderRole, startedAt?: Date): Promise<void> {
  const open = await tx.leadershipTenure.findFirst({ where: { userId, role, endedAt: null }, select: { id: true } });
  if (open) return;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { loginId: true, firstName: true, lastName: true, email: true, createdAt: true, employee: { select: { id: true } } } });
  if (!user || user.loginId.startsWith('SUP-')) return;
  await tx.leadershipTenure.create({
    data: { schoolId, userId, employeeId: user.employee?.id ?? null, role, name: `${user.firstName} ${user.lastName}`, loginId: user.loginId, email: user.email, startedAt: startedAt ?? user.createdAt },
  });
}

/** Ends the open period(s) of the login, recording how and who took over. */
export async function closeTenure(
  tx: TenantTx,
  schoolId: string,
  userId: string,
  end: { action: TenureEnd; reason?: string | null; replacedByName?: string | null; endedByUserId?: string | null; role?: LeaderRole },
): Promise<void> {
  const roles: LeaderRole[] = end.role ? [end.role] : ['school_admin', 'principal'];
  const held = await tx.userRole.findMany({ where: { userId, role: { key: { in: roles } } }, select: { role: { select: { key: true } } } });
  // A period that was never opened (older data) is opened from the login's start, then closed.
  for (const h of held) await openTenure(tx, schoolId, userId, h.role.key as LeaderRole);
  const by = end.endedByUserId ? await tx.user.findUnique({ where: { id: end.endedByUserId }, select: { firstName: true, lastName: true } }) : null;
  await tx.leadershipTenure.updateMany({
    where: { userId, role: { in: roles }, endedAt: null },
    data: { endedAt: new Date(), endAction: end.action, endReason: end.reason ?? null, replacedByName: end.replacedByName ?? null, endedByName: by ? `${by.firstName} ${by.lastName}` : null },
  });
}
