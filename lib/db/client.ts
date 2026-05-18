/**
 * Single pg.Pool + Drizzle wrapper. One pool per process, lazily constructed
 * on first call. Mirrors the behavior of the legacy server/db.ts: refuse
 * to start without DATABASE_URL, and swallow idle-client errors so a
 * stale connection doesn't crash the process (the pool reconnects).
 *
 * Importers should call getDb() / getPool() — these modules are pure and
 * additive in this PR; no other code imports them yet.
 */

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';
import { createLogger } from '@/lib/logger';

const { Pool } = pg;
const logger = createLogger('db');

let poolInstance: pg.Pool | null = null;
let dbInstance: NodePgDatabase<typeof schema> | null = null;

export function getPool(): pg.Pool {
  if (poolInstance) return poolInstance;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL must be set. Did you forget to provision a database?');
  }

  const pool = new Pool({ connectionString: url });
  pool.on('error', (err) => {
    logger.warn({ err: err.message }, 'Idle pool client error (non-fatal)');
  });

  poolInstance = pool;
  return pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (dbInstance) return dbInstance;
  dbInstance = drizzle(getPool(), { schema });
  return dbInstance;
}

export type Db = NodePgDatabase<typeof schema>;
export { schema };
