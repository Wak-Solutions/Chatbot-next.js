/**
 * Register the repeatable BullMQ jobs the worker owns. Replaces the
 * setInterval-based cron at worker/cron.ts (deleted in Phase 2).
 *
 * Repeatable jobs are keyed by jobId so re-running this on every worker
 * boot is a no-op past the first registration — BullMQ will refuse to
 * register a duplicate. The minute-tick cadence (`* * * * *`) matches
 * the legacy 60s setInterval.
 *
 * Per the manager's Phase 2 spec, the worker no longer gates the cron
 * tick on CRON_ENABLED — the queue is the coordinator, and BullMQ's
 * lock semantics on the repeatable job replace the legacy
 * Express+worker overlap protection.
 */

import { botQueue, cronQueue } from '@/lib/queue/queues';

export async function registerScheduledJobs(): Promise<void> {
  // Remove any meeting-reminder repeatable jobs that were previously
  // mis-registered on the bot-turns queue (wrong queue — belongs on cron-tasks).
  const staleRepeatables = await botQueue.getRepeatableJobs();
  for (const job of staleRepeatables) {
    if (job.name === 'meeting-reminder') {
      await botQueue.removeRepeatableByKey(job.key);
    }
  }

  await cronQueue.add(
    'meeting-reminder',
    {},
    {
      repeat: { pattern: '* * * * *' },
      jobId: 'meeting-reminder',
    },
  );
}
