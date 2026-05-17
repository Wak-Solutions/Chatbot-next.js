/**
 * Worker entrypoint — orchestrates env validation, pool readiness,
 * HTTP server (with /webhook from PR 13), cron scheduler, and graceful
 * shutdown.
 *
 * The Semaphore singleton (cap = DEFAULT_MAX = 8) is constructed here
 * and passed into the HTTP server so the /webhook receive path can
 * enqueue text/audio dispatches without exceeding the pool / OpenAI
 * concurrency budget.
 *
 * Shutdown ordering (SIGTERM/SIGINT):
 *
 *   1. Set shuttingDown flag — idempotent against double signals.
 *   2. server.close() — stop accepting new HTTP, let in-flight finish.
 *   3. cron.stop() — clear the interval so no new ticks start.
 *   4. cron.drain(timeoutMs) — wait for any in-flight cron tick.
 *   5. sema.drain(timeoutMs) — wait for any in-flight bot turns.
 *   6. pool.end() — close pg pool cleanly.
 *   7. process.exit(0).
 *
 *   Safety net: a 30s setTimeout (unref'd) calls process.exit(1) if
 *   any step above hangs. 30s matches Railway's SIGTERM-to-SIGKILL
 *   grace.
 */

import { loadWorkerEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { getPool } from '@/lib/db/client';
import { Semaphore } from './concurrency';
import { createWorkerServer } from './http/server';
import { startMeetingReminderCron, type CronHandle } from './cron';

const HARD_EXIT_MS = 30_000;
const DRAIN_BUDGET_MS = 28_000; // 30s minus 2s headroom for pool.end + exit

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

  const sema = new Semaphore();
  logger.info(
    { max: 8 },
    'Concurrency semaphore initialized',
  );

  const { server, close: closeServer } = createWorkerServer({ logger, sema });
  server.listen(env.PORT, env.HOST, () => {
    logger.info({ host: env.HOST, port: env.PORT }, 'Worker HTTP listening');
  });

  const cron: CronHandle | null = startMeetingReminderCron(logger);

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

      cron?.stop();
      logger.info('Cron stopped');

      if (cron) {
        const cronDrained = await cron.drain(DRAIN_BUDGET_MS / 2);
        logger.info({ drained: cronDrained, inflight: cron.inflightCount() }, 'Cron drained');
      }

      const semaDrained = await sema.drain(DRAIN_BUDGET_MS / 2);
      logger.info(
        { drained: semaDrained, inflight: sema.inflightCount, queued: sema.queuedCount },
        'Bot-turn semaphore drained',
      );

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
