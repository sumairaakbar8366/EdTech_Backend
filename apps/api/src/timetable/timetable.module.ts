import { Module } from '@nestjs/common';
import { ClassSessionsController, TimetableController } from './timetable.controller.js';
import { ClassRemindersService } from './class-reminders.service.js';
import { TimetableService } from './timetable.service.js';

@Module({
  controllers: [TimetableController, ClassSessionsController],
  providers: [TimetableService, ClassRemindersService],
  exports: [TimetableService],
})
export class TimetableModule {}
