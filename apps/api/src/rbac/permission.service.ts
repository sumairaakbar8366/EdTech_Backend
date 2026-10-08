import { Injectable } from '@nestjs/common';
import { permissionKey, type AccessLevel, type Module } from '@schoolerp/shared';
import { PrismaService } from '../prisma/prisma.service.js';

export interface UserAccess {
  roles: { key: string; name: string; level: number }[];
  permissions: string[];
}

/** Resolves a school user's roles and permissions (user_roles → role_permissions → permissions). */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async loadUserAccess(schoolId: string, userId: string): Promise<UserAccess> {
    const userRoles = await this.prisma.forSchool(schoolId).userRole.findMany({
      where: { userId },
      select: {
        role: {
          select: {
            key: true,
            name: true,
            level: true,
            rolePermissions: { select: { permission: { select: { module: true, action: true } } } },
          },
        },
      },
      orderBy: { role: { level: 'asc' } },
    });

    const permissions = new Set<string>();
    for (const { role } of userRoles) {
      for (const { permission } of role.rolePermissions) {
        permissions.add(permissionKey(permission.module as Module, permission.action as AccessLevel));
      }
    }
    return {
      roles: userRoles.map(({ role }) => ({ key: role.key, name: role.name, level: role.level })),
      permissions: [...permissions].sort(),
    };
  }
}
