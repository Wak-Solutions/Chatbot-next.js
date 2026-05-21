/**
 * Shared BullMQ queue handles. The worker, the webhook producer, and
 * the repeatable-job scheduler all reference these singletons.
 *
 * Single queue `bot-turns` carries three job types, dispatched on
 * job.name in worker/queueWorker.ts:
 *   - 'process-text'      → worker/tasks/processText (WhatsApp text in)
 *   - 'process-audio'     → worker/tasks/processAudio (WhatsApp voice in)
 *   - 'meeting-reminder'  → worker/tasks/meetingReminder (cron tick)
 *
 * Default job options:
 *   - 3 attempts with exponential backoff starting at 2s — matches the
 *     Phase 2 spec verbatim.
 *   - Retain last 1k completed / 5k failed jobs in Redis so the Bull
 *     Board (PR-Phase-2 Step 7) has history to render.
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
