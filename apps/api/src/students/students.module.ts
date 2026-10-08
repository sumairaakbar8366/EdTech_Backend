import { Module } from '@nestjs/common';
import { GuardiansController, StudentsController } from './students.controller.js';
import { StudentsService } from './students.service.js';
import { TaughtStudentsService } from './taught-students.service.js';

@Module({
  controllers: [StudentsController, GuardiansController],
  providers: [StudentsService, TaughtStudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
