import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StorageService } from '../storage/storage.service.js';
import { CandidatesController } from './candidates.controller.js';
import { CandidatesService } from './candidates.service.js';
import { OpportunitiesService } from './opportunities.service.js';
import { PostsService } from './posts.service.js';
import { ScholarshipsService } from './scholarships.service.js';
import { PostsAdminController, PostsPublicController, ScholarshipsAdminController, ScholarshipsPublicController } from './sponsorship.controller.js';

/** Global so a school's events and website can hand opportunities to the owner by injecting OpportunitiesService. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [CandidatesController, ScholarshipsAdminController, ScholarshipsPublicController, PostsAdminController, PostsPublicController],
  providers: [CandidatesService, OpportunitiesService, ScholarshipsService, PostsService, StorageService],
  exports: [OpportunitiesService],
})
export class SponsorshipModule {}
