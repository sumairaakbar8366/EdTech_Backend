import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SchoolProvisioningService } from './schools/school-provisioning.service.js';
import { SchoolsController } from './schools/schools.controller.js';
import { TiersController } from './tiers/tiers.controller.js';
import { TiersService } from './tiers/tiers.service.js';
import { SchoolApplicationsController } from './applications/school-applications.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [SchoolsController, TiersController, SchoolApplicationsController],
  providers: [SchoolProvisioningService, TiersService],
  exports: [SchoolProvisioningService],
})
export class PlatformModule {}
