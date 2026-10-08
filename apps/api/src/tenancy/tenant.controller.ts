import { Controller, Get, Req } from '@nestjs/common';
import { Public } from '../auth/decorators.js';
import type { AppRequest } from '../common/request-context.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Public tenant info for the login screen (name and branding only). */
@Controller('tenant')
export class TenantController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async current(@Req() req: AppRequest) {
    const tenant = req.tenant!;
    if (tenant.kind === 'platform') return { kind: 'platform' as const };

    const settings = await this.prisma.forSchool(tenant.schoolId).schoolSettings.findUnique({
      where: { schoolId: tenant.schoolId },
      select: { logoUrl: true, primaryColor: true, secondaryColor: true },
    });
    return {
      kind: 'school' as const,
      school: { name: tenant.name, slug: tenant.slug, branding: settings },
    };
  }
}
