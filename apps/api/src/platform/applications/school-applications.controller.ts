import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { PlatformOnly, Public } from '../../auth/decorators.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateSchoolApplicationDto, ReviewSchoolApplicationDto } from './school-application.dto.js';

@Controller()
export class SchoolApplicationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('public/school-applications')
  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async submit(@Body() dto: CreateSchoolApplicationDto) {
    if (dto.requestedTierCode) {
      const tier = await this.prisma.subscriptionTier.findUnique({
        where: { code: dto.requestedTierCode },
        select: { isActive: true },
      });
      if (!tier?.isActive) throw new BadRequestException('Unknown or inactive subscription tier');
    }

    // One open request per contact: stops accidental double submits and review-queue spam.
    const open = await this.prisma.schoolApplication.findFirst({
      where: { contactEmail: dto.contactEmail, status: { in: ['pending', 'approved'] } },
      select: { id: true },
    });
    if (open) throw new ConflictException('An application from this email is already under review');

    return this.prisma.schoolApplication.create({
      data: dto,
      select: { id: true, status: true, createdAt: true },
    });
  }

  @Get('platform/school-applications')
  @PlatformOnly()
  list() {
    return this.prisma.schoolApplication.findMany({ orderBy: { createdAt: 'desc' } });
  }

  @Patch('platform/school-applications/:id')
  @PlatformOnly()
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewSchoolApplicationDto,
  ) {
    // Conditional update, so two admins reviewing at once cannot both win.
    const { count } = await this.prisma.schoolApplication.updateMany({
      where: { id, status: 'pending' },
      data: { status: dto.status, reviewedAt: new Date() },
    });
    if (count === 0) {
      const exists = await this.prisma.schoolApplication.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundException('Application not found');
      throw new ConflictException('Only pending applications can be reviewed');
    }
    return this.prisma.schoolApplication.findUniqueOrThrow({ where: { id } });
  }
}
