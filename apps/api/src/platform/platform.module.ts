import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SchoolProvisioningService } from './schools/school-provisioning.service.js';
import { SchoolsController } from './schools/schools.controller.js';
import { TiersController } from './tiers/tiers.controller.js';
import { TiersService } from './tiers/tiers.service.js';
import { SystemController } from './system/system.controller.js';
import { SignupController } from './signup/signup.controller.js';
import { SignupService } from './signup/signup.service.js';
import { ConsoleController } from './console/console.controller.js';
import { ConsoleService } from './console/console.service.js';
import { PlatformSiteController, PublicSiteController } from './site/site.controller.js';
import { TeamController } from './team/team.controller.js';
import { TeamService } from './team/team.service.js';
import { RegistrationAdminController, RegistrationController } from './registration/registration.controller.js';
import { RegistrationService } from './registration/registration.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SchoolsController, TiersController, SystemController, SignupController, ConsoleController, PublicSiteController, PlatformSiteController, TeamController, RegistrationController, RegistrationAdminController],
  providers: [SchoolProvisioningService, TiersService, SignupService, ConsoleService, TeamService, RegistrationService],
  exports: [SchoolProvisioningService, SignupService],
})
export class PlatformModule {}
