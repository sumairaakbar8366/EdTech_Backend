import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PlatformOnly } from '../../auth/decorators.js';
import { CreateTierDto, ListTiersQuery, TiersService, UpdateTierDto } from './tiers.service.js';

/** Platform module "Subscription / Plans" (page 1 tiers): the owner manages the plan catalogue. */
@PlatformOnly()
@Controller('platform/tiers')
export class TiersController {
  constructor(private readonly tiers: TiersService) {}

  @Get()
  list(@Query() q: ListTiersQuery) {
    return this.tiers.list(q);
  }

  @Post()
  create(@Body() dto: CreateTierDto) {
    return this.tiers.create(dto);
  }

  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateTierDto) {
    return this.tiers.update(id, dto);
  }

  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.tiers.remove(id);
  }
}
