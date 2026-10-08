import { Module } from '@nestjs/common';
import { RbacModule } from '../rbac/rbac.module.js';
import { ExamsController } from './exams.controller.js';
import { ExamsService } from './exams.service.js';

@Module({
  imports: [RbacModule],
  controllers: [ExamsController],
  providers: [ExamsService],
})
export class ExamsModule {}
