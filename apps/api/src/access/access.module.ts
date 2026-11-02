import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { FormsModule } from '../forms/forms.module.js';
import { StaffModule } from '../staff/staff.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccessAdminController, AccessPublicController } from './access.controller.js';
import { AccessService } from './access.service.js';

@Module({ imports: [AuthModule, FormsModule, StaffModule, UsersModule], controllers: [AccessPublicController, AccessAdminController], providers: [AccessService] })
export class AccessModule {}
