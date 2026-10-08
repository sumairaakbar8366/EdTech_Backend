import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AcademicsModule } from './academics/academics.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { AdmissionsModule } from './admissions/admissions.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CampusesModule } from './campuses/campuses.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { FeesModule } from './fees/fees.module.js';
import { PayrollModule } from './payroll/payroll.module.js';
import { LmsModule } from './lms/lms.module.js';
import { ExamsModule } from './exams/exams.module.js';
import { AuditModule } from './audit/audit.module.js';
import { CommunicationModule } from './communication/communication.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { UsersModule } from './users/users.module.js';
import { DocumentRequestsModule } from './document-requests/document-requests.module.js';
import { WebsiteModule } from './website/website.module.js';
import { BillingModule } from './billing/billing.module.js';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { PlatformModule } from './platform/platform.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StaffModule } from './staff/staff.module.js';
import { StudentsModule } from './students/students.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { TimetableModule } from './timetable/timetable.module.js';
import { TenantMiddleware } from './tenancy/tenant.middleware.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // Throttling is applied per route with ThrottlerGuard (login, refresh).
    // In-memory storage: use a Redis store before running more than one API instance.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    RedisModule,
    TenancyModule,
    AuthModule,
    PlatformModule,
    CampusesModule,
    AcademicsModule,
    AccountsModule,
    DocumentsModule,
    StaffModule,
    StudentsModule,
    AdmissionsModule,
    TimetableModule,
    AttendanceModule,
    FeesModule,
    PayrollModule,
    LmsModule,
    ExamsModule,
    CommunicationModule,
    ReportsModule,
    AuditModule,
    SettingsModule,
    TasksModule,
    UsersModule,
    DocumentRequestsModule,
    WebsiteModule,
    BillingModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: PrismaExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'public/school-applications', method: RequestMethod.POST },
        // The marketing page's plan list: the same on every host.
        { path: 'public/plans', method: RequestMethod.GET },
      )
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
