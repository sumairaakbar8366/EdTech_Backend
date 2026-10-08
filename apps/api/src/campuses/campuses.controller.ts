import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentAuth, RequireAccess } from '../auth/decorators.js';
import type { AuthContext } from '../common/request-context.js';
import { CreateCampusDto, UpdateCampusDto } from './campus.dto.js';
import { CampusesService } from './campuses.service.js';

type SchoolAuth = Extract<AuthContext, { scope: 'school' }>;

/** Campus management is school configuration: page-15 "Settings" (admin CRUD). */
@RequireAccess('settings', ['crud'])
@Controller('campuses')
export class CampusesController {
  constructor(private readonly campuses: CampusesService) {}

  @Get()
  list(@CurrentAuth() auth: SchoolAuth) {
    return this.campuses.list(auth.schoolId);
  }

  @Post()
  create(@CurrentAuth() auth: SchoolAuth, @Body() dto: CreateCampusDto) {
    return this.campuses.create(auth.schoolId, dto);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: SchoolAuth,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampusDto,
  ) {
    return this.campuses.update(auth.schoolId, id, dto);
  }
}
