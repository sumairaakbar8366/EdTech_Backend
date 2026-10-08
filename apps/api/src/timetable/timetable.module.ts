import { Module } from '@nestjs/common';
import { ClassSessionsController, TimetableController } from './timetable.controller.js';
import { TimetableService } from './timetable.service.js';

@Module({
  controllers: [TimetableController, ClassSessionsController],
  providers: [TimetableService],
  exports: [TimetableService],
})
export class TimetableModule {}
