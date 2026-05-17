/**
 * Atomic claim of a Meta message_id for idempotency.
 *
 * Port of Chatbot/_db_inbox.py:9 try_claim_message_id.
 *
 *   Returns true  → this is the first time we've seen this id; caller
 *                   should process the message.
 *   Returns false → already claimed by an earlier retry of the same
 *                   payload; caller should skip.
 *
 * Fail-OPEN on DB error: prefer reprocessing (which is idempotent at
 * higher layers — conversation_id reuse, push-notification dedup) over
 * silent message loss.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('inbox-claim');

export async function claimMessageId(messageId: string): Promise<boolean> {
  if (!messageId) return true;
  try {
    const r = await getPool().query<{ message_id: string }>(
      `INSERT INTO processed_messages (message_id)
       VALUES ($1)
       ON CONFLICT (message_id) DO NOTHING
       RETURNING message_id`,
      [messageId],
    );
    return r.rows.length > 0;
  } catch (err) {
    logger.error(
      { messageId, err: (err as Error)?.message },
      'try_claim_message_id failed',
    );
    return true;
  }
}
