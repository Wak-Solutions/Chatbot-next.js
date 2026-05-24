/**
 * Shared BullMQ queue handles.
 *
 *   botQueue ('bot-turns')   — WhatsApp message processing.
 *                              Jobs: 'process-text', 'process-audio'.
 *                              Consumed by botWorker (concurrency 8).
 *   cronQueue ('cron-tasks') — scheduled / repeatable jobs.
 *                              Jobs: 'meeting-reminder'.
 *                              Consumed by cronWorker (concurrency 2).
 *
 * Split per manager directive: a burst of webhook jobs on the shared
 * queue was delaying the minute-tick meeting-reminder repeatable by
 * minutes. Separate queues isolate the two workloads — bot bursts no
 * longer starve the cron, and cron ticks don't fight for slots that
 * should be serving customers.
 */

import { Queue } from 'bullmq';
import { getConnection } from './connection';

export const botQueue = new Queue('bot-turns', {
  connection: getConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1_000 },
    removeOnFail: { count: 5_000 },
  },
});

export const cronQueue = new Queue('cron-tasks', {
  connection: getConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});
