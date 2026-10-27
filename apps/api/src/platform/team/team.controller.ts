import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsIn, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { CurrentAuth, PlatformOnly } from '../../auth/decorators.js';
import type { AuthContext } from '../../common/request-context.js';
import { LEAD_ROLES, TeamService, type LeadRole } from './team.service.js';

type PlatformAuth = Extract<AuthContext, { scope: 'platform' }>;

class AddOwnerDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @IsString() @MaxLength(100) @Matches(/\S/) name: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(254) email: string;
}

class OwnerStatusDto {
  @IsBoolean() active: boolean;
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class AddLeaderDto {
  @IsUUID() schoolId: string;
  @IsIn(LEAD_ROLES) role: LeadRole;
  @Transform(trim) @IsString() @MaxLength(80) @Matches(/\S/) firstName: string;
  @Transform(trim) @IsString() @MaxLength(80) @Matches(/\S/) lastName: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(254) email: string;
}

class RoleQuery {
  @IsIn(LEAD_ROLES) role: LeadRole;
}

/** The owner team: the main owner shares the console with others ("Owner 2", "Owner 3"…). */
@PlatformOnly()
@Controller('platform/team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  list() {
    return this.team.list();
  }

  /** Main owner only; the temporary password is shown once and never cached. */
  @Post()
  async add(@CurrentAuth() a: PlatformAuth, @Body() dto: AddOwnerDto, @Res({ passthrough: true }) res: Response) {
    await this.assertPrimary(a.adminId);
    res.setHeader('Cache-Control', 'no-store');
    return this.team.add(a.adminId, dto.name, dto.email);
  }

  /** Who is principal and admin in every school. */
  @Get('leadership')
  leadership() {
    return this.team.leadership();
  }

  @Post('leadership')
  addLeader(@Body() dto: AddLeaderDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.team.addLeader(dto.schoolId, dto.role, { firstName: dto.firstName, lastName: dto.lastName, email: dto.email });
  }

  @Delete('leadership/:schoolId/:userId')
  removeLeader(@Param('schoolId', ParseUUIDPipe) schoolId: string, @Param('userId', ParseUUIDPipe) userId: string, @Query() q: RoleQuery) {
    return this.team.removeLeader(schoolId, userId, q.role);
  }

  @Post(':id/status') @HttpCode(HttpStatus.OK)
  async status(@CurrentAuth() a: PlatformAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OwnerStatusDto) {
    await this.assertPrimary(a.adminId);
    return this.team.setActive(id, dto.active);
  }

  private async assertPrimary(adminId: string) {
    if (!(await this.team.isPrimary(adminId))) throw new ForbiddenException('Only the main owner can manage the owner team');
  }
}
