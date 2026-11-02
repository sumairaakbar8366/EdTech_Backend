import 'dotenv/config';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

/**
 * Removes schools and everything they own (people, records, logins, subscriptions, applications,
 * registrations). It connects as the schema owner (MIGRATION_DATABASE_URL) and:
 *
 *   - lists what it would delete and stops, unless --yes is given (always take a backup first);
 *   - refuses the "demo" school, and any school that is not named with --slugs;
 *   - deletes in one transaction, so a failure leaves everything as it was.
 *
 *   npm run delete-schools -w @schoolerp/api -- --slugs=high-school,ak-high-school [--yes]
 */
const PROTECTED = new Set(['demo']);

async function run() {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const slugs = (arg('slugs') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const yes = process.argv.includes('--yes');
  if (!slugs.length) throw new Error('Usage: delete-schools --slugs=a,b [--yes]');
  const blocked = slugs.filter((s) => PROTECTED.has(s));
  if (blocked.length) throw new Error(`Refusing to delete protected school(s): ${blocked.join(', ')}`);
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set');

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const { rows: schools } = await db.query<{ id: string; slug: string; name: string }>('SELECT id, slug, name FROM schools WHERE slug = ANY($1)', [slugs]);
    const missing = slugs.filter((s) => !schools.some((x) => x.slug === s));
    if (missing.length) console.log(`Not found (skipped): ${missing.join(', ')}`);
    if (!schools.length) return;
    const ids = schools.map((s) => s.id);

    // Every table that points at a school: the tenant tables (school_id) and the platform ones.
    const { rows: tables } = await db.query<{ table_name: string }>(
      `SELECT DISTINCT c.table_name FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND c.column_name = 'school_id' AND c.table_name <> 'schools'`,
    );
    const counts: Record<string, number> = {};
    for (const { table_name } of tables) {
      const r = await db.query<{ n: string }>(`SELECT count(*) n FROM "${table_name}" WHERE school_id = ANY($1)`, [ids]);
      if (Number(r.rows[0]!.n)) counts[table_name] = Number(r.rows[0]!.n);
    }
    console.log(`\nSchools to delete:\n${schools.map((s) => `  - ${s.name} (${s.slug})`).join('\n')}\n\nRows that go with them:`);
    for (const [t, n] of Object.entries(counts).sort()) console.log(`  ${t.padEnd(34)} ${n}`);
    if (!yes) return void console.log('\nDry run only. Add --yes to delete (after a backup).\n');

    await db.query('BEGIN');
    try {
      // The owner connection may switch off foreign-key checks for this transaction, so the order of the
      // many tables does not matter; everything that referenced the schools is removed together.
      await db.query("SET LOCAL session_replication_role = 'replica'");
      for (const { table_name } of tables) await db.query(`DELETE FROM "${table_name}" WHERE school_id = ANY($1)`, [ids]);
      await db.query('DELETE FROM schools WHERE id = ANY($1)', [ids]);
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK');
      throw e;
    }
    // Their uploaded files (photos, documents) go too: the folder is named by the school's id.
    const storage = resolve(process.env.STORAGE_DIR ?? './storage');
    for (const id of ids) if (/^[0-9a-f-]{36}$/.test(id)) await rm(resolve(storage, id), { recursive: true, force: true });
    console.log(`\nDeleted ${schools.length} school(s) and their files.\n`);
  } finally {
    await db.end();
  }
}

await run();
