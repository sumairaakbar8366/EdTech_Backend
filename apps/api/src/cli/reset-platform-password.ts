import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { temporaryPassword } from '../accounts/accounts.service.js';
import { AppModule } from '../app.module.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Platform owner account recovery (there is no one above the owner to reset it):
 *   npm run reset-platform-password -w @schoolerp/api -- owner@example.com
 * Prints a new password once; run it on the server.
 */
async function run() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) throw new Error('Usage: npm run reset-platform-password -w @schoolerp/api -- <email>');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const admin = await prisma.platformAdmin.findUnique({ where: { email } });
    if (!admin) throw new Error(`No platform admin with email ${email}`);
    const password = temporaryPassword();
    await prisma.platformAdmin.update({ where: { id: admin.id }, data: { passwordHash: await app.get(PasswordService).hash(password), isActive: true } });
    console.log(`\nNew password for ${email}:  ${password}\nSign in at the platform console and keep it safe.\n`);
  } finally {
    await app.close();
  }
}

await run();
