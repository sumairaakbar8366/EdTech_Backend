import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ActivityService } from './activity.service.js';
import { ActivityController, AuditController, PlatformActivityController } from './audit.controller.js';
import { AuditInterceptor } from './audit.interceptor.js';

@Module({ controllers: [AuditController, ActivityController, PlatformActivityController], providers: [ActivityService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }] })
export class AuditModule {}
