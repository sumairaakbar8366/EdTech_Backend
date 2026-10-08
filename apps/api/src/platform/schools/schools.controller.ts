import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { temporaryPassword } from '../../accounts/accounts.service.js';
import { AuthService } from '../../auth/auth.service.js';
import { PasswordService } from '../../auth/password.service.js';
import { PlatformOnly } from '../../auth/decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantResolverService } from '../../tenancy/tenant-resolver.service.js';
import { CreateSchoolDto, UpdateSchoolStatusDto } from './create-school.dto.js';
import { SchoolProvisioningService } from './school-provisioning.service.js';

/** Platform module "Tenant Management". */
@PlatformOnly()
@Controller('platform/schools')
export class SchoolsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: SchoolProvisioningService,
    private readonly resolver: TenantResolverService,
    private readonly passwords: PasswordService,
    private readonly auth: AuthService,
  ) {}

  /** The school's admins (for "reset admin password"). */
  @Get(':id/admins')
  admins(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.inSchoolTransaction(id, (tx) =>
      tx.user.findMany({
        where: { userRoles: { some: { role: { key: 'school_admin' } } } },
        select: { id: true, firstName: true, lastName: true, email: true, status: true, lastLoginAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /**
   * Account recovery for a school admin who is locked out: a new temporary password (shown once)
   * that must be changed at sign-in; all their sessions end.
   */
  @Post(':id/admins/:userId/reset-password')
  @HttpCode(HttpStatus.OK)
  async resetAdminPassword(@Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const password = temporaryPassword();
    const user = await this.prisma.inSchoolTransaction(id, async (tx) => {
      const u = await tx.user.findFirst({ where: { id: userId, userRoles: { some: { role: { key: 'school_admin' } } } }, select: { id: true, email: true, firstName: true, lastName: true, status: true } });
      if (!u) throw new NotFoundException('School admin not found');
      if (u.status !== 'active') throw new BadRequestException('This login is disabled');
      await tx.user.update({ where: { id: u.id }, data: { passwordHash: await this.passwords.hash(password), mustChangePassword: true } });
      return u;
    });
    await this.auth.endSessions(id, user.id);
    return { user, temporaryPassword: password };
  }

  @Get()
  list() {
    return this.prisma.school.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        subscriptions: {
          where: { status: { in: ['trialing', 'active', 'past_due'] } },
          select: {
            status: true,
            trialEndsAt: true,
            tier: { select: { code: true, name: true } },
          },
        },
      },
    });
  }

  @Post()
  create(@Body() dto: CreateSchoolDto) {
    return this.provisioning.provision(dto);
  }

  @Patch(':id/status')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSchoolStatusDto) {
    const school = await this.prisma.school.update({
      where: { id },
      data: { status: dto.status },
      select: { id: true, slug: true, status: true },
    });
    this.resolver.invalidate();
    return school;
  }
}
