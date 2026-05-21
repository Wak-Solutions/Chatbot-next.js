/**
 * Shared ioredis connection for BullMQ. Singleton so the worker, the
 * queue producers (webhook handler), and the scheduler all share one
 * TCP connection per process.
 *
 * `maxRetriesPerRequest: null` is required by BullMQ — without it
 * BullMQ logs a startup warning and a misbehaving Redis disconnect
 * surfaces as a thrown error instead of a queued retry. See:
 * https://docs.bullmq.io/guide/connections
 */

import IORedis from 'ioredis';
import { getWorkerEnv } from '@/lib/env';

let _conn: IORedis | null = null;

export function getConnection(): IORedis {
  if (!_conn) {
    _conn = new IORedis(getWorkerEnv().REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return _conn;
}
