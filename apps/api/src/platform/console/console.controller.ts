import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { CurrentAuth, PlatformOnly } from '../../auth/decorators.js';
import type { AuthContext } from '../../common/request-context.js';
import { ConsoleService, type PersonKind } from './console.service.js';

type PlatformAuth = Extract<AuthContext, { scope: 'platform' }>;

class SchoolsQuery {
  @IsOptional() @IsIn(['trial', 'active', 'grace', 'expired']) phase?: 'trial' | 'active' | 'grace' | 'expired';
  @IsOptional() @IsIn(['self_signup', 'application', 'console']) source?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

class PeopleQuery {
  @IsIn(['teacher', 'staff', 'student', 'parent']) type: PersonKind;
  /** People are listed per school (on the school's detail page). */
  @IsUUID() schoolId: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 50;
}


class SetSubscriptionDto {
  @IsString() @MaxLength(40) tierCode: string;
  @IsIn(['trialing', 'active']) status: 'trialing' | 'active';
  @Matches(/^\d{4}-\d{2}-\d{2}$/) endsOn: string;
  @IsOptional() @IsIn(['monthly', 'annual']) billingCycle?: 'monthly' | 'annual';
}

/** Platform owner console: schools (list and full detail), growth, revenue, support sessions and plans. */
@PlatformOnly()
@Controller('platform')
export class ConsoleController {
  constructor(private readonly console: ConsoleService) {}

  @Get('console/schools')
  schools(@Query() q: SchoolsQuery) {
    return this.console.schools(q);
  }

  @Get('console/schools/:id')
  school(@Param('id', ParseUUIDPipe) id: string) {
    return this.console.school(id);
  }

  @Get('console/growth')
  growth() {
    return this.console.growth();
  }

  @Get('console/people')
  people(@Query() q: PeopleQuery) {
    return this.console.people(q.type, q);
  }


  @Get('console/finance')
  finance() {
    return this.console.finance();
  }

  /** "Open as admin": a one-time link (2 minutes) into the school; the session lasts one hour. */
  @Post('schools/:id/support-session')
  @HttpCode(HttpStatus.OK)
  support(@CurrentAuth() a: PlatformAuth, @Param('id', ParseUUIDPipe) id: string) {
    return this.console.supportSession(a.adminId, id);
  }

  @Patch('schools/:id/subscription')
  setSubscription(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetSubscriptionDto) {
    return this.console.setSubscription(id, dto);
  }
}
