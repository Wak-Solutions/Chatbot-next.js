/**
 * Worker cron scheduler.
 *
 * Gated by CRON_ENABLED=1 (default OFF). Deploying the worker with the
 * default config binds /health and waits — it does NOT start firing
 * reminder claims until an operator flips the flag. The runbook's
 * PR 12 cutover uses this two-step deploy → flip pattern so the
 * deploy is reversible and the cron activation is observable.
 *
 * Two-writer overlap during the PR 12 cutover window is the design:
 * the legacy Express (CRON_ONLY=1 from PR 11) and this worker BOTH
 * run the claim simultaneously. The atomic UPDATE in
 * @/lib/meetings/reminders.claimReminder guarantees only one wins per
 * meeting. Do NOT add defensive "is the other service running?"
 * checks here — the database is the coordinator.
 *
 * Returns a handle the orchestrator can stop+drain on shutdown. If
 * CRON_ENABLED is not '1', returns null and logs why.
 */

import type { Logger } from '@/lib/logger';
import { meetingReminderTick } from './tasks/meetingReminder';

const TICK_INTERVAL_MS = 60_000;

export interface CronHandle {
  stop(): void;
  /** Resolves true if drained within timeoutMs, false on timeout. */
  drain(timeoutMs: number): Promise<boolean>;
  /** Diagnostic — number of currently in-flight ticks (0 or 1 in practice). */
  inflightCount(): number;
}

export function startMeetingReminderCron(logger: Logger): CronHandle | null {
  if (process.env.CRON_ENABLED !== '1') {
    logger.info('Meeting reminder cron DISABLED (set CRON_ENABLED=1 to enable)');
    return null;
  }

  let inflight = 0;
  let stopped = false;

  const runTick = async (): Promise<void> => {
    if (stopped) return;
    inflight++;
    try {
      await meetingReminderTick(logger);
    } finally {
      inflight--;
    }
  };

  const handle = setInterval(() => {
    void runTick();
  }, TICK_INTERVAL_MS);

  logger.info(
    { interval_ms: TICK_INTERVAL_MS },
    'Meeting reminder cron started',
  );

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      clearInterval(handle);
    },
    async drain(timeoutMs: number): Promise<boolean> {
      const start = Date.now();
      while (inflight > 0) {
        if (Date.now() - start > timeoutMs) return false;
        await new Promise((r) => setTimeout(r, 100));
      }
      return true;
    },
    inflightCount(): number {
      return inflight;
    },
  };
}
