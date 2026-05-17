/**
 * Meeting-reminder claim/release primitives — port of the row-claim
 * pattern at server/lib/meeting-reminders.ts:29-46.
 *
 * The cron itself moves to the worker in PR 12. This module just exposes
 * the atomic primitives the worker calls:
 *
 *   findPendingReminders() — pull the next batch (≤50) of meetings due
 *                            within the 14-16 minute pre-meeting window.
 *   claimReminder(id)      — atomically flip link_sent FALSE → TRUE.
 *                            Returns true if THIS caller won the claim.
 *   releaseReminder(id)    — best-effort release after a send failure
 *                            so a later tick can retry. Errors swallowed.
 *
 * PORTED VERBATIM — the atomic `UPDATE … WHERE link_sent = FALSE
 * RETURNING id` is what makes the claim safe under overlapping ticks.
 * Do NOT "improve" to SELECT-then-UPDATE — that reintroduces the race
 * the original explicitly closes.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('reminders');

export const REMIND_MIN_BEFORE = 15;
export const REMINDER_BATCH_SIZE = 50;

export interface PendingReminder {
  id: number;
  customer_phone: string;
  meeting_link: string;
  scheduled_at: Date;
  company_id: number;
}

/**
 * Returns up to REMINDER_BATCH_SIZE meetings due to fire in the
 * 14-16 minute window relative to NOW(). The window has 1 minute of
 * jitter on each side so a minute-aligned cron can still catch jobs
 * regardless of clock drift.
 */
export async function findPendingReminders(): Promise<PendingReminder[]> {
  const r = await getPool().query<PendingReminder>(
    `SELECT id, customer_phone, meeting_link, scheduled_at, company_id
     FROM meetings
     WHERE link_sent = FALSE
       AND meeting_link IS NOT NULL
       AND scheduled_at IS NOT NULL
       AND scheduled_at BETWEEN NOW() + INTERVAL '${REMIND_MIN_BEFORE - 1} minutes'
                            AND NOW() + INTERVAL '${REMIND_MIN_BEFORE + 1} minutes'
     LIMIT ${REMINDER_BATCH_SIZE}`,
  );
  return r.rows;
}

/**
 * Atomic claim — returns true if THIS caller flipped link_sent from
 * FALSE to TRUE, false if another concurrent tick already did so.
 *
 *   UPDATE meetings SET link_sent = TRUE
 *   WHERE id = $1 AND link_sent = FALSE
 *   RETURNING id
 */
export async function claimReminder(meetingId: number): Promise<boolean> {
  const r = await getPool().query<{ id: number }>(
    'UPDATE meetings SET link_sent = TRUE WHERE id = $1 AND link_sent = FALSE RETURNING id',
    [meetingId],
  );
  return r.rows.length > 0;
}

/**
 * Best-effort release. Called after the post-claim work fails (e.g. the
 * WhatsApp send returned non-2xx) so a later tick can re-attempt. Errors
 * are swallowed — failing to release at worst delays the retry by 24h
 * when the reminder window has passed; raising would mask the original
 * send failure.
 */
export async function releaseReminder(meetingId: number): Promise<void> {
  try {
    await getPool().query(
      'UPDATE meetings SET link_sent = FALSE WHERE id = $1',
      [meetingId],
    );
  } catch (err) {
    logger.error(
      { meetingId, err: (err as Error)?.message },
      'releaseReminder failed (non-fatal)',
    );
  }
}
