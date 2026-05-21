/**
 * Worker entrypoint — env validation, pool readiness, HTTP server,
 * BullMQ worker + repeatable jobs, graceful shutdown.
 *
 * Phase 2 replaced the in-process Semaphore + setInterval cron with a
 * BullMQ worker reading from a Redis-backed queue. The webhook now
 * enqueues a job and returns 200; the queueWorker picks the job up
 * and runs processText/processAudio with concurrency 8.
 *
 * Shutdown ordering (SIGTERM/SIGINT) — manager's spec requires this
 * exact order:
 *
 *   1. Set shuttingDown flag — idempotent against double signals.
 *   2. server.close() — stop accepting new HTTP, let in-flight finish.
 *   3. queueWorker.close() — let BullMQ finish in-flight jobs and stop
 *      polling Redis.
 *   4. pool.end() — close pg pool cleanly.
 *   5. process.exit(0).
 *
 *   Safety net: a 30s setTimeout (unref'd) calls process.exit(1) if
 *   any step above hangs. 30s matches Railway's SIGTERM-to-SIGKILL
 *   grace.
 */

import { loadWorkerEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { getPool } from '@/lib/db/client';
import { createWorkerServer } from './http/server';
import { startQueueWorker } from './queueWorker';
import { registerScheduledJobs } from './scheduledJobs';

const HARD_EXIT_MS = 30_000;

async function main(): Promise<void> {
  const env = loadWorkerEnv();

  const logger = createLogger('worker');

  try {
    await getPool().query('SELECT 1');
  } catch (err) {
    logger.error(
      { err: (err as Error)?.message },
      'DB probe failed — aborting boot',
    );
    process.exit(1);
  }
  logger.info('DB pool ready');

  const { server, close: closeServer } = createWorkerServer({ logger });
  server.listen(env.PORT, env.HOST, () => {
    logger.info({ host: env.HOST, port: env.PORT }, 'Worker HTTP listening');
  });

  const queueWorker = startQueueWorker();
  logger.info({ concurrency: 8 }, 'BullMQ worker started');

  await registerScheduledJobs();
  logger.info('Repeatable jobs registered');

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutdown signal received');

    setTimeout(() => {
      logger.error(
        { ms: HARD_EXIT_MS },
        'Hard-exit timeout fired — forcing exit',
      );
      process.exit(1);
    }, HARD_EXIT_MS).unref();

    try {
      logger.info('Closing HTTP server');
      await closeServer();

      logger.info('Closing BullMQ worker');
      await queueWorker.close();

      logger.info('Closing pg pool');
      await getPool().end();

      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err: (err as Error)?.message }, 'Shutdown error');
      process.exit(1);
    }
  };

  process.on('SIGTERM', (sig) => void shutdown(sig));
  process.on('SIGINT', (sig) => void shutdown(sig));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err: err?.stack ?? String(err) }, 'Uncaught exception');
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  console.error('[worker] fatal boot error:', err);
  process.exit(1);
});
