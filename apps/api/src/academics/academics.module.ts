import { Module } from '@nestjs/common';
import { AcademicsController } from './academics.controller.js';
import { AcademicStructureService } from './academic-structure.service.js';
import { AcademicYearsService } from './academic-years.service.js';

@Module({
  controllers: [AcademicsController],
  providers: [AcademicYearsService, AcademicStructureService],
})
export class AcademicsModule {}
