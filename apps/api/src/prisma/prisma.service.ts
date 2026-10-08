import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';

/** Transaction client handed to tenant-scoped callbacks. */
export type TenantTx = Prisma.TransactionClient;

/**
 * Database access.
 *
 * - `this` (the base client) is for platform tables only: schools, domains, tiers,
 *   subscriptions, platform admins and the permission catalog. Queries against
 *   tenant tables through it return nothing, because no school is set for RLS.
 * - `forSchool(schoolId)` returns a client whose every query runs with
 *   app.current_school_id set, so Postgres RLS limits it to that school.
 * - `inSchoolTransaction(schoolId, fn)` runs several statements in one transaction
 *   with the school set.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  forSchool(schoolId: string) {
    assertUuid(schoolId);
    return this.$extends(
      Prisma.defineExtension((client) =>
        client.$extends({
          name: 'tenant-scope',
          query: {
            $allModels: {
              async $allOperations({ args, query }) {
                // set_config(..., true) is transaction-local, so the setting cannot leak to
                // another request that reuses this pooled connection.
                const [, result] = await client.$transaction([
                  client.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`,
                  query(args),
                ]);
                return result;
              },
            },
          },
        }),
      ),
    );
  }

  async inSchoolTransaction<T>(
    schoolId: string,
    fn: (tx: TenantTx) => Promise<T>,
    options?: { timeout?: number },
  ): Promise<T> {
    assertUuid(schoolId);
    return this.$transaction(
      async (tx) => {
        await setSchool(tx, schoolId);
        return fn(tx);
      },
      { timeout: options?.timeout ?? 10_000 },
    );
  }
}

/** Sets the RLS school for the rest of the current transaction. */
export async function setSchool(tx: TenantTx, schoolId: string): Promise<void> {
  assertUuid(schoolId);
  await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolId}, true)`;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error('Invalid school id for tenant scope');
  }
}

export type SchoolScopedClient = ReturnType<PrismaService['forSchool']>;
