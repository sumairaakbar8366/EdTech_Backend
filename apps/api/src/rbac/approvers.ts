import type { PrismaService } from '../prisma/prisma.service.js';

/** Roles that receive and decide approvals (leave, payroll, requests): the principal and the School Admins. */
export const APPROVER_ROLES = ['principal', 'school_admin'] as const;

/** Active approvers of a school, without the platform owner's hidden support login. */
export async function approverIds(prisma: PrismaService, schoolId: string): Promise<string[]> {
  const rows = await prisma.forSchool(schoolId).user.findMany({
    where: { status: 'active', NOT: { loginId: { startsWith: 'SUP-' } }, userRoles: { some: { role: { key: { in: [...APPROVER_ROLES] } } } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
