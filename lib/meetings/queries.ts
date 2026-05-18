/**
 * Per-customer meeting queries used by the worker orchestrator.
 *
 *   getPendingMeeting — port of Chatbot/_db_meetings.py:38. Returns the
 *                       latest pending meeting for a customer, or null.
 *                       Used by the orchestrator to inject a real
 *                       booking URL into the system prompt and to
 *                       short-circuit when a customer already has one.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('meetings-queries');

export interface PendingMeeting {
  id: number;
  meeting_link: string | null;
  agreed_time: string | null;
  meeting_token: string | null;
  scheduled_at: Date | null;
}

export async function getPendingMeeting(
  customerPhone: string,
  companyId: number,
): Promise<PendingMeeting | null> {
  try {
    const r = await getPool().query<PendingMeeting>(
      `SELECT id, meeting_link, agreed_time, meeting_token, scheduled_at
       FROM meetings
       WHERE customer_phone = $1 AND status = 'pending' AND company_id = $2
         AND (token_expires_at IS NULL OR token_expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 1`,
      [customerPhone, companyId],
    );
    return r.rows[0] ?? null;
  } catch (err) {
    logger.error(
      { companyId, err: (err as Error)?.message },
      'getPendingMeeting failed',
    );
    return null;
  }
}
