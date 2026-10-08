import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { HiringController } from '../hiring/hiring.controller.js';
import { HiringService } from '../hiring/hiring.service.js';
import { StaffController, TeacherAssignmentsController } from './staff.controller.js';
import { StaffService } from './staff.service.js';
import { TeacherAssignmentsService } from './teacher-assignments.service.js';

@Module({
  imports: [AuthModule],
  controllers: [StaffController, TeacherAssignmentsController, HiringController],
  providers: [StaffService, TeacherAssignmentsService, HiringService],
  exports: [StaffService, HiringService],
})
export class StaffModule {}
