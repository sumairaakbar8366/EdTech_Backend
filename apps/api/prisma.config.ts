import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// The Prisma CLI (migrate, studio) connects as the schema owner.
// The running API uses DATABASE_URL (the RLS-restricted app role) through the pg adapter.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('MIGRATION_DATABASE_URL'),
  },
});
