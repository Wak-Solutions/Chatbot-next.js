/**
 * Worker /health handler. Same shape as app/api/health/route.ts:
 *
 *   200 OK   { status: 'ok',       database: 'connected',   service: 'worker' }
 *   503 SU   { status: 'degraded', database: 'unreachable', service: 'worker' }
 *
 * Adds `service: 'worker'` so a single load-balanced /health probe can
 * distinguish dashboard-next from the worker without DNS / port checks.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { getPool } from '@/lib/db/client';
import type { Logger } from '@/lib/logger';

export function makeHealthHandler(logger: Logger) {
  return async function handleHealth(
    _req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      await getPool().query('SELECT 1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', database: 'connected', service: 'worker' }));
    } catch (err) {
      logger.error(
        { err: (err as Error)?.message },
        'Health check DB probe failed',
      );
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ status: 'degraded', database: 'unreachable', service: 'worker' }),
      );
    }
  };
}
