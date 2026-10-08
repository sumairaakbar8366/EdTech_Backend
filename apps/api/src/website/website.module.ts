import { Module } from '@nestjs/common';
import { AdmissionsModule } from '../admissions/admissions.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { StaffModule } from '../staff/staff.module.js';
import { WebsiteAdminController, WebsitePublicController } from './website.controller.js';
import { WebsiteService } from './website.service.js';

@Module({
  imports: [AdmissionsModule, StaffModule, DocumentsModule],
  controllers: [WebsiteAdminController, WebsitePublicController],
  providers: [WebsiteService],
})
export class WebsiteModule {}
