/**
 * Worker /health handler — Fastify route handler shape.
 *
 *   200 OK   { status: 'ok',       database: 'connected',   service: 'worker' }
 *   503      { status: 'degraded', database: 'unreachable', service: 'worker' }
 *
 * `service: 'worker'` distinguishes this from the dashboard /health probe.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { getPool } from '@/lib/db/client';
import type { Logger } from '@/lib/logger';

export function makeHealthHandler(logger: Logger) {
  return async function handleHealth(
    _req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      await getPool().query('SELECT 1');
      await reply.send({ status: 'ok', database: 'connected', service: 'worker' });
    } catch (err) {
      logger.error(
        { err: (err as Error)?.message },
        'Health check DB probe failed',
      );
      await reply.status(503).send({
        status: 'degraded',
        database: 'unreachable',
        service: 'worker',
      });
    }
  };
}
