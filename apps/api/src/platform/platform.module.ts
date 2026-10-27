import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SchoolProvisioningService } from './schools/school-provisioning.service.js';
import { SchoolsController } from './schools/schools.controller.js';
import { TiersController } from './tiers/tiers.controller.js';
import { TiersService } from './tiers/tiers.service.js';
import { SchoolApplicationsController } from './applications/school-applications.controller.js';
import { SystemController } from './system/system.controller.js';
import { SignupController } from './signup/signup.controller.js';
import { SignupService } from './signup/signup.service.js';
import { ConsoleController } from './console/console.controller.js';
import { ConsoleService } from './console/console.service.js';
import { PlatformSiteController, PublicSiteController } from './site/site.controller.js';
import { TeamController } from './team/team.controller.js';
import { TeamService } from './team/team.service.js';

@Module({
  imports: [AuthModule],
  controllers: [SchoolsController, TiersController, SchoolApplicationsController, SystemController, SignupController, ConsoleController, PublicSiteController, PlatformSiteController, TeamController],
  providers: [SchoolProvisioningService, TiersService, SignupService, ConsoleService, TeamService],
  exports: [SchoolProvisioningService],
})
export class PlatformModule {}
