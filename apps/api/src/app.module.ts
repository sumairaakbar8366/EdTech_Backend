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
import { PhotosModule } from './photos/photos.module.js';
import { CommunicationModule } from './communication/communication.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { UsersModule } from './users/users.module.js';
import { DocumentRequestsModule } from './document-requests/document-requests.module.js';
import { WebsiteModule } from './website/website.module.js';
import { BillingModule } from './billing/billing.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { AutomationModule } from './automation/automation.module.js';
import { FormsModule } from './forms/forms.module.js';
import { AccessModule } from './access/access.module.js';
import { ComplaintsModule } from './complaints/complaints.module.js';
import { SponsorshipModule } from './sponsorship/sponsorship.module.js';
import { EventsModule } from './events/events.module.js';
import { InsightsModule } from './insights/insights.module.js';
import { ToursModule } from './tours/tours.module.js';
import { PrismaExceptionFilter } from './common/prisma-exception.filter.js';
import { validateEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { PlatformModule } from './platform/platform.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { DeliveryModule } from './delivery/delivery.module.js';
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
    JobsModule,
    DeliveryModule,
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
    PhotosModule,
    SettingsModule,
    TasksModule,
    UsersModule,
    DocumentRequestsModule,
    WebsiteModule,
    BillingModule,
    PaymentsModule,
    AutomationModule,
    FormsModule,
    AccessModule,
    ComplaintsModule,
    SponsorshipModule,
    EventsModule,
    InsightsModule,
    ToursModule,
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
        // The marketing page's plan list: the same on every host.
        { path: 'public/plans', method: RequestMethod.GET },
        // The main site's contact details / social accounts and the sitemap (no tenant).
        { path: 'public/site-settings', method: RequestMethod.GET },
        { path: 'public/sitemap.xml', method: RequestMethod.GET },
        // The verified school registration on the marketing site, and the offers/posts the owner publishes.
        { path: 'public/registration/form', method: RequestMethod.GET },
        { path: 'public/registration/email-code', method: RequestMethod.POST },
        { path: 'public/registration/email-verify', method: RequestMethod.POST },
        { path: 'public/registration/google', method: RequestMethod.POST },
        { path: 'public/registration/phone-code', method: RequestMethod.POST },
        { path: 'public/registration/phone-verify', method: RequestMethod.POST },
        { path: 'public/registration', method: RequestMethod.POST },
        { path: 'public/scholarship-offers/:token', method: RequestMethod.GET },
        { path: 'public/scholarship-offers/:token', method: RequestMethod.POST },
        { path: 'public/scholarship-offers/:token/decline', method: RequestMethod.POST },
        { path: 'public/posts', method: RequestMethod.GET },
        { path: 'public/posts/image/:id', method: RequestMethod.GET },
        // Sign-up / sign-in options (Google, email check): the same on every host.
        { path: 'public/signup/config', method: RequestMethod.GET },
        // "Continue with Google" for a school, completed on the main site.
        { path: 'public/social/ticket', method: RequestMethod.POST },
        // The main domain's single /login (owner and every school).
        { path: 'public/login', method: RequestMethod.POST },
        { path: 'public/login/verify', method: RequestMethod.POST },
        // The payment gateway's checkout page (sandbox) and webhooks: no tenant.
        { path: 'public/pay/:token', method: RequestMethod.GET },
        { path: 'public/pay/:token/complete', method: RequestMethod.POST },
        { path: 'public/payments/webhook/:provider', method: RequestMethod.POST },
      )
      .forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
