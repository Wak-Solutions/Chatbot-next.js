/**
 * scripts/mark-baseline.ts — record the baseline migration as already applied
 * in production WITHOUT running its DDL.
 *
 * NOT run during PR 2. This is the cutover-phase runbook artifact for when
 * DB access is available.
 *
 * Run exactly ONCE in production, after PR 14 strips the inline
 * CREATE TABLE / ALTER TABLE blocks from boot. Inserts a row into
 * drizzle.__drizzle_migrations so subsequent `drizzle-kit migrate` calls
 * skip the baseline and only apply post-baseline migrations.
 *
 * Safe to run repeatedly — idempotent on the hash column.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/mark-baseline.ts
 *
 * If your drizzle-kit version stores migration metadata in the public schema
 * instead of the drizzle schema, adjust DRIZZLE_MIGRATIONS_TABLE below. The
 * default below matches drizzle-kit 0.31.x.
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';

const BASELINE_FILENAME = '0000_baseline.sql';
const DRIZZLE_MIGRATIONS_TABLE = 'drizzle.__drizzle_migrations';

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL must be set.');
    process.exit(1);
  }

  const sqlPath = new URL(`../drizzle/${BASELINE_FILENAME}`, import.meta.url);
  const sqlText = await readFile(sqlPath, 'utf8');
  const hash = createHash('sha256').update(sqlText).digest('hex');

  const pool = new Pool({ connectionString: dbUrl });
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${DRIZZLE_MIGRATIONS_TABLE} (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL UNIQUE,
        created_at BIGINT
      )
    `);
    const result = await pool.query(
      `INSERT INTO ${DRIZZLE_MIGRATIONS_TABLE} (hash, created_at)
       VALUES ($1, $2)
       ON CONFLICT (hash) DO NOTHING
       RETURNING id`,
      [hash, Date.now()],
    );
    if (result.rows.length === 0) {
      console.log(`Baseline (${hash.slice(0, 12)}…) already marked applied.`);
    } else {
      console.log(
        `Baseline marked applied. id=${result.rows[0].id}, hash=${hash.slice(0, 12)}…`,
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
