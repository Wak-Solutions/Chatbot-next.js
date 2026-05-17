/**
 * Shared helpers for integration tests that need a real Postgres.
 *
 * Skip pattern (vitest 4): `describe.skipIf(!hasDatabaseUrl())` still
 * executes the describe body for test enumeration even when the suite
 * is skipped, so any throw at the top of the body escapes the skip.
 * Do NOT call `requireDatabaseUrl()` or `newTestPool()` directly inside
 * the describe body. Lazy-init the pool inside `beforeAll`:
 *
 *   describe.skipIf(!hasDatabaseUrl())('...', () => {
 *     let pool: Pool;
 *     beforeAll(() => { pool = newTestPool(); });
 *     afterAll(async () => { await pool.end(); });
 *     // ...
 *   });
 *
 * `beforeAll` only runs when the suite is NOT skipped, so the throw
 * never fires in the DATABASE_URL-unset case.
 *
 * Each integration test is responsible for truncating only the rows
 * it touches. There is no global "wipe everything" — we don't want to
 * accidentally nuke a shared dev database. Tests use unique
 * customer_phone / company_id fixtures and DELETE-by-fixture in
 * beforeEach/afterEach.
 */

import { Pool } from 'pg';

export const hasDatabaseUrl = (): boolean => Boolean(process.env.DATABASE_URL);

/** Throws if DATABASE_URL is not set. Used by integration test guards. */
export function requireDatabaseUrl(): string {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL not set — integration tests require a test Postgres instance.',
    );
  }
  return process.env.DATABASE_URL;
}

/** A throwaway pool — closed by the caller in afterAll. */
export function newTestPool(): Pool {
  return new Pool({ connectionString: requireDatabaseUrl() });
}
