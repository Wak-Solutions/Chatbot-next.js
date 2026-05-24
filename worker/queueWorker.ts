/**
 * BullMQ workers — one per queue, per manager directive.
 *
 *   botWorker  ('bot-turns', concurrency 8)
 *     Handles WhatsApp message processing. Dispatched on job.name:
 *       'process-text'  → worker/tasks/processText.processText
 *       'process-audio' → worker/tasks/processAudio.processAudio
 *     Concurrency 8 matches the legacy Semaphore.DEFAULT_MAX so the
 *     per-process load profile on Postgres + OpenAI doesn't change.
 *
 *     (Spec shorthand showed `await getReply(job.data)` directly. Kept
 *     the process-text/audio wrappers same as Phase 2 — getReply only
 *     computes the reply text; the wrappers do the send + outbound row
 *     persist + apology fallback that the bot actually needs.)
 *
 *   cronWorker ('cron-tasks', concurrency 2)
 *     Handles scheduled / repeatable jobs. Dispatched on job.name:
 *       'meeting-reminder' → worker/tasks/meetingReminder.meetingReminderTask
 *     Concurrency 2 is a comfortable upper bound for the minute-tick
 *     and keeps contention on the meetings table low.
 *
 * Unknown job.name → throw, lets BullMQ apply the default retry policy
 * and surface via the 'failed' listener.
 */

import { Worker, type Job } from 'bullmq';
import { getConnection } from '@/lib/queue/connection';
import { processText, type ProcessTextInput } from '@/worker/tasks/processText';
import { processAudio, type ProcessAudioInput } from '@/worker/tasks/processAudio';
import { meetingReminderTask } from '@/worker/tasks/meetingReminder';
import { logger } from '@/lib/logger';

const BOT_CONCURRENCY = 8;
const CRON_CONCURRENCY = 2;

export interface QueueWorkers {
  botWorker: Worker;
  cronWorker: Worker;
}

export function startQueueWorker(): QueueWorkers {
  const botWorker = new Worker(
    'bot-turns',
    async (job: Job) => {
      if (job.name === 'process-text') {
        await processText(job.data as ProcessTextInput, job.id ?? '');
        return;
      }
      if (job.name === 'process-audio') {
        await processAudio(job.data as ProcessAudioInput, job.id ?? '');
        return;
      }
      throw new Error(`Unknown bot job name: ${job.name}`);
    },
    {
      connection: getConnection(),
      concurrency: BOT_CONCURRENCY,
    },
  );

  const cronWorker = new Worker(
    'cron-tasks',
    async (job: Job) => {
      if (job.name === 'meeting-reminder') {
        await meetingReminderTask();
        return;
      }
      logger.warn({ jobName: job.name }, 'Unknown cron job');
    },
    {
      connection: getConnection(),
      concurrency: CRON_CONCURRENCY,
    },
  );

  botWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Bot job failed'),
  );
  cronWorker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Cron job failed'),
  );

  return { botWorker, cronWorker };
}
