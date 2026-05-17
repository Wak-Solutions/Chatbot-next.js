/**
 * scripts/migrate.ts — apply pending Drizzle migrations.
 *
 * Runs as Railway's preDeployCommand on the dashboard service ONLY.
 * The worker service must NOT run this — two services racing the same
 * journal would corrupt the migrations metadata.
 *
 * Uses drizzle-orm's programmatic migrate() helper, which:
 *   1. Reads drizzle/meta/_journal.json (committed alongside the SQL files).
 *   2. Compares against drizzle.__drizzle_migrations rows in the DB.
 *   3. Applies any pending SQL files in order.
 *   4. Inserts a row per applied migration (hash + when).
 *
 * Idempotent — re-running with no pending migrations exits 0 with a
 * "no migrations to apply" log line (the drizzle-orm migrate function
 * itself is silent in that case; we add the explicit log so the
 * Railway deploy log shows something useful).
 *
 * Exit codes:
 *   0  on success (whether or not anything was applied).
 *   1  on any failure — Railway treats non-zero as a failed predeploy
 *      and refuses to route traffic to the new container.
 *
 * IMPORTANT: this script does NOT call drizzle-kit push. Push bypasses
 * the migration journal and would corrupt baseline tracking. Migrations
 * are file-based and journaled — that's the whole point.
 */

import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const MIGRATIONS_FOLDER = './drizzle';

async function listMigrationFiles(): Promise<string[]> {
  // Best-effort enumeration of *.sql files so we can log the count
  // BEFORE migrate() applies anything. Pure cosmetic; if this fails
  // we still proceed.
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const folder = join(here, '..', 'drizzle');
    const entries = await readdir(folder);
    return entries.filter((n) => n.endsWith('.sql')).sort();
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[migrate] DATABASE_URL must be set.');
    process.exit(1);
  }

  const files = await listMigrationFiles();
  console.log(
    `[migrate] migrations folder=${MIGRATIONS_FOLDER}, sql files on disk=${files.length}`,
  );

  const pool = new Pool({ connectionString: dbUrl });
  const db = drizzle(pool);

  // Capture the applied-count delta around the migrate() call. The
  // drizzle.__drizzle_migrations table is created by migrate() on first
  // run; pre-query may 42P01 (undefined_table). Tolerate that.
  let beforeCount: number | null = null;
  try {
    const r = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations',
    );
    beforeCount = parseInt(r.rows[0].count, 10);
  } catch {
    beforeCount = null;
  }

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (err) {
    console.error('[migrate] FAILED:', (err as Error)?.message ?? err);
    await pool.end().catch(() => {});
    process.exit(1);
  }

  let afterCount: number | null = null;
  try {
    const r = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations',
    );
    afterCount = parseInt(r.rows[0].count, 10);
  } catch {
    afterCount = null;
  }

  if (beforeCount !== null && afterCount !== null) {
    const applied = afterCount - beforeCount;
    if (applied > 0) {
      console.log(`[migrate] applied ${applied} migration${applied === 1 ? '' : 's'}`);
    } else {
      console.log('[migrate] no migrations to apply');
    }
  } else {
    console.log('[migrate] complete (could not read migration counts pre/post — see drizzle output above)');
  }

  await pool.end().catch(() => {});

  // Silence unused-import warnings for readFile (kept available for
  // future per-file detail logging without restructuring imports).
  void readFile;
}

main().catch((err) => {
  console.error('[migrate] fatal:', err);
  process.exit(1);
});
