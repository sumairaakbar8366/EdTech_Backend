import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { CandidatesService, ConfirmCandidatesDto } from './candidates.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;
/** The principal and the admin choose which students a school puts forward. */
const Manage = () => RequireAccess('students', ['crud']);
const Id = () => new ParseUUIDPipe();

@Controller('scholarship-candidates')
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Manage() @Get('programs')
  programs(@CurrentAuth() a: SchoolAuth) { return this.candidates.programs(a.schoolId); }

  @Manage() @Get(':requestId/shortlist')
  shortlist(@CurrentAuth() a: SchoolAuth, @Param('requestId', Id()) id: string) { return this.candidates.shortlist(a.schoolId, id); }

  @Manage() @Get(':requestId/nominations')
  nominations(@CurrentAuth() a: SchoolAuth, @Param('requestId', Id()) id: string) { return this.candidates.mine(a.schoolId, id); }

  @Manage() @Post(':requestId/confirm') @HttpCode(HttpStatus.OK)
  confirm(@CurrentAuth() a: SchoolAuth, @Param('requestId', Id()) id: string, @Body() dto: ConfirmCandidatesDto) { return this.candidates.confirm(a.schoolId, a.userId, id, dto); }
}
