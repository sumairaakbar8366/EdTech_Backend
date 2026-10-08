import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DEFAULT_TIERS } from '@schoolerp/shared';
import { AppModule } from '../app.module.js';
import { PasswordService } from '../auth/password.service.js';
import type { Env } from '../config/env.js';
import { SchoolProvisioningService } from '../platform/schools/school-provisioning.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Idempotent seed. Runs through the application's own services and the RLS-restricted
 * app role, so seeded data follows exactly the same rules as real data.
 *
 * - permission catalog (page 15)
 * - subscription tiers (page 1); existing tiers keep any prices set by the platform admin
 * - first platform admin (from SEED_PLATFORM_ADMIN_*)
 * - default grants for system roles in existing schools (after matrix changes)
 * - optional "demo" school (SEED_DEMO_SCHOOL=true)
 */
async function seed() {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const config = app.get<ConfigService<Env, true>>(ConfigService);
    const prisma = app.get(PrismaService);
    const passwords = app.get(PasswordService);
    const provisioning = app.get(SchoolProvisioningService);

    await provisioning.ensurePermissionCatalog();
    logger.log('Permission catalog ready');

    for (const tier of DEFAULT_TIERS) {
      await prisma.subscriptionTier.upsert({
        where: { code: tier.code },
        create: { ...tier },
        update: {
          name: tier.name,
          maxCampuses: tier.maxCampuses,
          maxStudents: tier.maxStudents,
          maxStaff: tier.maxStaff,
          pricingModel: tier.pricingModel,
          sortOrder: tier.sortOrder,
        },
      });
    }
    logger.log(`Subscription tiers ready: ${DEFAULT_TIERS.map((t) => t.code).join(', ')}`);

    const adminEmail = config.get('SEED_PLATFORM_ADMIN_EMAIL', { infer: true })?.toLowerCase();
    const adminPassword = config.get('SEED_PLATFORM_ADMIN_PASSWORD', { infer: true });
    if (adminEmail && adminPassword) {
      const existing = await prisma.platformAdmin.findUnique({ where: { email: adminEmail } });
      if (!existing) {
        await prisma.platformAdmin.create({
          data: { email: adminEmail, name: 'Platform Owner', passwordHash: await passwords.hash(adminPassword) },
        });
        logger.log(`Platform admin created: ${adminEmail}`);
      } else {
        logger.log(`Platform admin exists: ${adminEmail}`);
      }
    }

    const added = await provisioning.syncSystemRolePermissions();
    logger.log(`System role permissions in sync (${added} grant${added === 1 ? '' : 's'} added)`);

    const defaults = await provisioning.syncSchoolDefaults();
    logger.log(`School defaults in sync (${defaults} added)`);

    if (config.get('SEED_DEMO_SCHOOL', { infer: true }) && adminPassword) {
      const demo = await prisma.school.findUnique({ where: { slug: 'demo' } });
      if (!demo) {
        await provisioning.provision({
          name: 'Demo Public School',
          slug: 'demo',
          tierCode: 'growth',
          timezone: 'UTC',
          campus: { name: 'Main Campus', code: 'MAIN' },
          admin: { email: 'admin@demo.school', firstName: 'Demo', lastName: 'Admin', password: adminPassword },
        }, new Date(), false);
        logger.log('Demo school created: demo (admin@demo.school, password = SEED_PLATFORM_ADMIN_PASSWORD)');
      } else {
        logger.log('Demo school exists: demo');
      }
    }
  } finally {
    await app.close();
  }
}

await seed();
