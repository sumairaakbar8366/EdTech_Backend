import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { CandidatesQuery, EmailCodeDto, GrantAccessDto, ListUsersQuery, SetEmailDto, SetRolesDto, SetStatusDto, ShareAccessDto, UpdateSharedAccessDto } from './users.dto.js';
import { UsersService } from './users.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
/** School administrators only (settings: crud). */
const Admin = () => RequireAccess('settings', ['crud']);

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Admin() @Get()
  list(@CurrentAuth() a: SchoolAuth, @Query() q: ListUsersQuery) {
    return this.users.list(a.schoolId, q);
  }

  @Admin() @Get('summary')
  summary(@CurrentAuth() a: SchoolAuth) {
    return this.users.summary(a.schoolId);
  }

  @Admin() @Get('candidates')
  candidates(@CurrentAuth() a: SchoolAuth, @Query() q: CandidatesQuery) {
    return this.users.candidates(a.schoolId, q);
  }

  /** Responses carrying a temporary password are never cached. */
  @Admin() @Post()
  grant(@CurrentAuth() a: SchoolAuth, @Body() dto: GrantAccessDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.users.grant(a.schoolId, a.userId, dto);
  }

  /** Shared admin accounts ("Admin 2"…) and what each may use. */
  @Admin() @Get('shared')
  shared(@CurrentAuth() a: SchoolAuth) {
    return this.users.listShared(a.schoolId);
  }

  @Admin() @Post('shared')
  share(@CurrentAuth() a: SchoolAuth, @Body() dto: ShareAccessDto, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.users.share(a.schoolId, a.userId, dto);
  }

  @Admin() @Patch('shared/:roleId')
  updateShared(@CurrentAuth() a: SchoolAuth, @Param('roleId', ParseUUIDPipe) roleId: string, @Body() dto: UpdateSharedAccessDto) {
    return this.users.updateShared(a.schoolId, roleId, dto.access);
  }

  @Admin() @Post('shared/:roleId/revoke') @HttpCode(HttpStatus.OK)
  revokeShared(@CurrentAuth() a: SchoolAuth, @Param('roleId', ParseUUIDPipe) roleId: string) {
    return this.users.revokeShared(a.schoolId, roleId);
  }

  /** Sends a 6-digit code to a person's email; they tell it to the admin to prove the address. */
  @Admin() @Post('email-code') @HttpCode(HttpStatus.OK)
  emailCode(@CurrentAuth() a: SchoolAuth, @Body() dto: EmailCodeDto) {
    return this.users.sendEmailCode(a.schoolId, a.userId, dto.email);
  }

  @Admin() @Patch(':id/email')
  setEmail(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetEmailDto) {
    return this.users.setEmail(a.schoolId, a.userId, id, dto);
  }

  @Admin() @Patch(':id/roles')
  setRoles(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetRolesDto) {
    return this.users.setRoles(a.schoolId, a.userId, id, dto.roles);
  }

  @Admin() @Post(':id/reset-password') @HttpCode(HttpStatus.OK)
  resetPassword(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.users.resetPassword(a.schoolId, a.userId, id);
  }

  @Admin() @Post(':id/status') @HttpCode(HttpStatus.OK)
  setStatus(@CurrentAuth() a: SchoolAuth, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStatusDto) {
    return this.users.setStatus(a.schoolId, a.userId, id, dto.status);
  }
}
