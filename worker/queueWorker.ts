/**
 * BullMQ worker. Replaces the in-process Semaphore (deleted in Phase 2)
 * with a distributed job queue backed by Redis. Started once from
 * worker/index.ts at boot.
 *
 * Concurrency: 8 — matches the legacy Semaphore.DEFAULT_MAX so the
 * per-process load profile on Postgres + OpenAI doesn't change.
 *
 * Job dispatch is by `job.name`:
 *   - 'meeting-reminder'  → worker/tasks/meetingReminder.meetingReminderTask
 *   - 'process-text'      → worker/tasks/processText.processText
 *   - 'process-audio'     → worker/tasks/processAudio.processAudio
 *
 * The spec sketched `await getReply(job.data)` as the bot-turn handler,
 * but getReply only COMPUTES a reply — it doesn't send it back via
 * WhatsApp or persist the outbound row. processText / processAudio are
 * the existing wrappers that do the full inbound→reply→send cycle, and
 * the webhook already produced payloads matching their input shapes.
 * Routing here preserves the bot's send behavior end-to-end.
 *
 * Unknown job.name → throw, which lets BullMQ apply the queue's default
 * retry policy (3 attempts, exponential backoff) and surface it via
 * the 'failed' listener below.
 */

import { Worker, type Job } from 'bullmq';
import { getConnection } from '@/lib/queue/connection';
import { processText, type ProcessTextInput } from '@/worker/tasks/processText';
import { processAudio, type ProcessAudioInput } from '@/worker/tasks/processAudio';
import { meetingReminderTask } from '@/worker/tasks/meetingReminder';
import { logger } from '@/lib/logger';

const CONCURRENCY = 8;

export function startQueueWorker(): Worker {
  const worker = new Worker(
    'bot-turns',
    async (job: Job) => {
      if (job.name === 'meeting-reminder') {
        await meetingReminderTask();
        return;
      }
      if (job.name === 'process-text') {
        await processText(job.data as ProcessTextInput);
        return;
      }
      if (job.name === 'process-audio') {
        await processAudio(job.data as ProcessAudioInput);
        return;
      }
      throw new Error(`Unknown job name: ${job.name}`);
    },
    {
      connection: getConnection(),
      concurrency: CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, 'Job failed');
  });

  return worker;
}
