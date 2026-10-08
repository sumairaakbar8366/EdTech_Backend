import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import {
  PERMISSION_CATALOG,
  RESERVED_SLUGS,
  SCHOOL_ROLES,
  defaultPermissionsForRole,
  isSchoolRoleKey,
  permissionKey,
  trialPeriod,
  type AccessLevel,
  type Module,
} from '@schoolerp/shared';
import { PasswordService } from '../../auth/password.service.js';
import { PrismaService, setSchool, type TenantTx } from '../../prisma/prisma.service.js';
import { TenantResolverService } from '../../tenancy/tenant-resolver.service.js';
import type { CreateSchoolDto } from './create-school.dto.js';

/** Default leave types for a new school; administrators can change them later. */
export const DEFAULT_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual leave', annualQuota: 10, isPaid: true },
  { code: 'SL', name: 'Sick leave', annualQuota: 8, isPaid: true },
  { code: 'AL', name: 'Annual leave', annualQuota: 14, isPaid: true },
  { code: 'UL', name: 'Unpaid leave', annualQuota: null, isPaid: false },
] as const;

async function ensureLeaveTypes(tx: TenantTx, schoolId: string): Promise<number> {
  const { count } = await tx.leaveType.createMany({
    data: DEFAULT_LEAVE_TYPES.map((t) => ({ schoolId, ...t })),
    skipDuplicates: true,
  });
  return count;
}

/**
 * Onboards a new school tenant (page 1: Platform Admin → provisions → School Tenant).
 * Everything happens in one transaction, so a failure leaves nothing behind.
 */
@Injectable()
export class SchoolProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly resolver: TenantResolverService,
  ) {}

  /** Idempotently makes sure the global permission catalog matches the page-15 matrix. */
  async ensurePermissionCatalog(): Promise<void> {
    await this.prisma.permission.createMany({
      data: PERMISSION_CATALOG.map((p) => ({ module: p.module, action: p.action, description: p.description })),
      skipDuplicates: true,
    });
  }

  /**
   * Adds any default grants a system role is missing in existing schools (e.g. after a
   * matrix row is added). Only adds; never removes grants, so school customizations stay.
   * Returns the number of grants added.
   */
  async syncSystemRolePermissions(): Promise<number> {
    await this.ensurePermissionCatalog();
    const permissionIds = await this.permissionIdMap();
    const schools = await this.prisma.school.findMany({ select: { id: true } });
    let added = 0;
    for (const { id: schoolId } of schools) {
      added += await this.prisma.inSchoolTransaction(schoolId, async (tx) => {
        const roles = await tx.role.findMany({ where: { isSystem: true }, select: { id: true, key: true } });
        const data = roles.flatMap((role) =>
          isSchoolRoleKey(role.key)
            ? defaultPermissionsForRole(role.key).map((key) => ({
                roleId: role.id,
                permissionId: permissionIds.get(key)!,
                schoolId,
              }))
            : [],
        );
        if (data.length === 0) return 0;
        return (await tx.rolePermission.createMany({ data, skipDuplicates: true })).count;
      });
    }
    return added;
  }

  /** Backfills per-school defaults added after a school was provisioned (idempotent). */
  async syncSchoolDefaults(): Promise<number> {
    const schools = await this.prisma.school.findMany({ select: { id: true } });
    let added = 0;
    for (const { id } of schools) added += await this.prisma.inSchoolTransaction(id, (tx) => ensureLeaveTypes(tx, id));
    return added;
  }

  private async permissionIdMap(): Promise<Map<string, string>> {
    const rows = await this.prisma.permission.findMany();
    return new Map(rows.map((p) => [permissionKey(p.module as Module, p.action as AccessLevel), p.id]));
  }

  /** `temporaryAdminPassword: false` only for development seeding (the demo login). */
  async provision(dto: CreateSchoolDto, now: Date = new Date(), temporaryAdminPassword = true) {
    if (RESERVED_SLUGS.has(dto.slug)) throw new BadRequestException('This slug is reserved');
    if (dto.timezone && !isValidTimeZone(dto.timezone)) throw new BadRequestException('Unknown timezone');

    const tier = await this.prisma.subscriptionTier.findUnique({ where: { code: dto.tierCode } });
    if (!tier || !tier.isActive) throw new BadRequestException('Unknown or inactive subscription tier');

    if (await this.prisma.school.findUnique({ where: { slug: dto.slug }, select: { id: true } })) {
      throw new ConflictException('A school with this slug already exists');
    }

    await this.ensurePermissionCatalog();
    const permissionIds = await this.permissionIdMap();
    const passwordHash = await this.passwords.hash(dto.admin.password);
    const { trialStartsAt, trialEndsAt } = trialPeriod(now);

    const result = await this.prisma.$transaction(
      async (tx) => {
        // Platform-level records.
        const school = await tx.school.create({ data: { name: dto.name, slug: dto.slug } });
        if (dto.applicationId) {
          const linked = await tx.schoolApplication.updateMany({
            where: { id: dto.applicationId, status: 'approved' },
            data: { status: 'onboarded', schoolId: school.id },
          });
          if (linked.count !== 1) throw new ConflictException('Application is not approved for onboarding');
        }
        const subscription = await tx.subscription.create({
          data: { schoolId: school.id, tierId: tier.id, status: 'trialing', trialStartsAt, trialEndsAt },
        });

        // Tenant-owned records: RLS now scopes this transaction to the new school.
        await setSchool(tx, school.id);
        await tx.schoolSettings.create({
          data: {
            schoolId: school.id,
            timezone: dto.timezone ?? 'UTC',
            currency: dto.currency ?? tier.currency,
            primaryColor: dto.primaryColor ?? null,
          },
        });
        const campus = await tx.campus.create({
          data: { schoolId: school.id, name: dto.campus.name, code: dto.campus.code, isMain: true },
        });

        const roleIds = new Map<string, string>();
        for (const def of SCHOOL_ROLES) {
          const role = await tx.role.create({
            data: {
              schoolId: school.id,
              key: def.key,
              name: def.name,
              level: def.level,
              description: def.description,
              isSystem: true,
            },
          });
          roleIds.set(def.key, role.id);
          const grants = defaultPermissionsForRole(def.key).map((key) => {
            const permissionId = permissionIds.get(key);
            if (!permissionId) throw new Error(`Permission ${key} missing from catalog`);
            return { roleId: role.id, permissionId, schoolId: school.id };
          });
          if (grants.length > 0) await tx.rolePermission.createMany({ data: grants });
        }

        await ensureLeaveTypes(tx, school.id);

        const admin = await tx.user.create({
          data: {
            schoolId: school.id,
            email: dto.admin.email,
            passwordHash,
            mustChangePassword: temporaryAdminPassword,
            firstName: dto.admin.firstName,
            lastName: dto.admin.lastName,
          },
        });
        await tx.userRole.create({
          data: { userId: admin.id, roleId: roleIds.get('school_admin')!, schoolId: school.id },
        });

        return {
          school,
          subscription: { id: subscription.id, status: subscription.status, tier: tier.code, trialStartsAt, trialEndsAt },
          mainCampus: { id: campus.id, name: campus.name, code: campus.code },
          admin: { id: admin.id, email: admin.email },
        };
      },
      { timeout: 20_000 },
    );

    this.resolver.invalidate();
    return result;
  }
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
