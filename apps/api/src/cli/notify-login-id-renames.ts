import 'reflect-metadata';
import './no-jobs.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { DeliveryService } from '../delivery/delivery.service.js';
import { OwnerAlertsService } from '../delivery/owner-alerts.service.js';
import { WebUrls } from '../delivery/web-urls.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Emails everyone whose User ID was renumbered when IDs became platform-wide, once each:
 *   npm run notify-login-id-renames -w @schoolerp/api
 * Run it after email delivery (SMTP) works. People without an email are listed for the owner.
 */
async function run() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const delivery = app.get(DeliveryService);
    const urls = app.get(WebUrls);
    const renames = await prisma.loginIdRename.findMany({ where: { notifiedAt: null }, orderBy: { createdAt: 'asc' } });
    const noEmail: string[] = [];
    for (const r of renames) {
      const school = await prisma.school.findUnique({ where: { id: r.schoolId }, select: { name: true, slug: true } });
      const user = await prisma.forSchool(r.schoolId).user.findUnique({ where: { id: r.userId }, select: { firstName: true, lastName: true, email: true } });
      // Hidden support logins (SUP-…) are never typed by anyone: nothing to tell.
      if (!school || !user || r.newLoginId.startsWith('SUP-')) {
        await prisma.loginIdRename.update({ where: { userId: r.userId }, data: { notifiedAt: new Date() } });
        continue;
      }
      if (user.email) {
        await delivery.send({ channel: 'email', to: user.email, schoolId: r.schoolId, template: 'login_id_changed', data: { name: user.firstName, schoolName: school.name, oldLoginId: r.oldLoginId, newLoginId: r.newLoginId, signInUrl: urls.school(school.slug, '/login') } });
        console.log(`emailed ${user.email}: ${r.oldLoginId} -> ${r.newLoginId} (${school.name})`);
      } else {
        noEmail.push(`${user.firstName} ${user.lastName} at ${school.name}: ${r.oldLoginId} -> ${r.newLoginId}`);
      }
      await prisma.loginIdRename.update({ where: { userId: r.userId }, data: { notifiedAt: new Date() } });
    }
    if (noEmail.length) {
      await app.get(OwnerAlertsService).raise({ kind: 'user_id_request', title: `${noEmail.length} renumbered User ID(s) have no email`, body: `Tell these people their new User ID: ${noEmail.join('; ')}.` });
      console.log(`no email (listed in the owner's notifications):\n  ${noEmail.join('\n  ')}`);
    }
    console.log(`\n${renames.length} rename(s) processed.`);
  } finally {
    await app.close();
  }
}

await run();
