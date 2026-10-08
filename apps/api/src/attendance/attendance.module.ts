import { CommunicationModule } from '../communication/communication.module.js';
import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { LeaveController, StaffAttendanceController, StudentAttendanceController } from './attendance.controller.js';
import { LeaveService } from './leave.service.js';
import { StaffAttendanceService } from './staff-attendance.service.js';
import { StudentAttendanceService } from './student-attendance.service.js';

@Module({
  imports: [RbacModule, CommunicationModule],
  controllers: [StudentAttendanceController, StaffAttendanceController, LeaveController],
  providers: [StudentAttendanceService, StaffAttendanceService, LeaveService],
  exports: [StaffAttendanceService, LeaveService],
})
export class AttendanceModule {}
