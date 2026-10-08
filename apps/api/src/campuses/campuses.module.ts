import { Module } from '@nestjs/common';
import { CampusesController } from './campuses.controller.js';
import { CampusesService } from './campuses.service.js';

@Module({
  controllers: [CampusesController],
  providers: [CampusesService],
})
export class CampusesModule {}
