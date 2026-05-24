/**
 * Outbound message idempotency guard.
 *
 * Problem: if a BullMQ job crashes after sendWhatsAppTextWithCreds() sends
 * the reply but before the job completes, the retry attempt runs the full
 * processText/processAudio pipeline again and sends the same message twice.
 *
 * Fix: before sending, atomically claim an idempotency key in Redis via
 * SET NX. On retry the key already exists — claimOutbound returns false
 * and the send is skipped. The outbound DB row is still persisted (saveMessage
 * is idempotent via the messages table unique constraint).
 *
 * Key format : outbound:<jobId>
 * TTL         : 24 hours — covers all retry windows (3 attempts,
 *               exponential backoff starting at 2s), never bloats Redis.
 *
 * When jobId is empty (caller has no job context) claimOutbound returns
 * true so the send always proceeds — safe for direct / non-queued callers.
 */

import { getConnection } from '@/lib/queue/connection';

const TTL_SECONDS = 60 * 60 * 24;

/**
 * Returns true  → first attempt, safe to send.
 * Returns false → a previous attempt already sent this reply, skip send.
 */
export async function claimOutbound(jobId: string): Promise<boolean> {
  if (!jobId) return true;
  const result = await getConnection().set(
    `outbound:${jobId}`,
    '1',
    'EX',
    TTL_SECONDS,
    'NX',
  );
  return result === 'OK';
}
