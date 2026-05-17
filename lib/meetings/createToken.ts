/**
 * Token issuance for the public booking flow.
 *
 * Unifies two existing flows into one helper:
 *   - server/routes/meetings.routes.ts:94-117 — the Express endpoint
 *     that does the unlocked INSERT.
 *   - Chatbot/_agent_booking.py:34-130 — the Python caller's advisory
 *     lock + 3-attempt retry pattern that prevents two concurrent
 *     webhook deliveries from minting two tokens for the same customer.
 *
 * PR 13 will retire the /api/meetings/create-token HTTP hop and call
 * this helper directly from the worker (per D-1).
 *
 * Lock key derivation differs from Python's hash() — `hash()` returns
 * different values across processes (PYTHONHASHSEED) so the lock would
 * not actually serialize across the dashboard and the worker. Switched
 * to @/lib/db/locks.lockKey (SHA-256 → bigint, deterministic) so two
 * different writers contend on the same key.
 *
 * Returns:
 *   { token, reused: false } on a fresh insert.
 *   { token, reused: true  } if an existing pending token (<5 min old)
 *                            was found — either by us (fast path) or by
 *                            another writer we lost the lock to.
 *   null                     after 3 failed attempts (caller surfaces 500).
 */

import crypto from 'node:crypto';
import { getPool } from '@/lib/db/client';
import { lockKey } from '@/lib/db/locks';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';

const logger = createLogger('create-token');

const MAX_ATTEMPTS = 3;
const RETRY_SLEEP_MS = 500;
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const REUSE_WINDOW_MINUTES = 5;

export interface CreateTokenResult {
  token: string;
  reused: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function issueMeetingToken(input: {
  companyId: number;
  customerPhone: string;
}): Promise<CreateTokenResult | null> {
  const { companyId, customerPhone } = input;
  const key = lockKey(`booking-token:${companyId}:${customerPhone}`);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      const lockRes = await client.query<{ pg_try_advisory_xact_lock: boolean }>(
        'SELECT pg_try_advisory_xact_lock($1::bigint)',
        [key.toString()],
      );
      const acquired = lockRes.rows[0]?.pg_try_advisory_xact_lock === true;

      if (acquired) {
        const existing = await client.query<{ meeting_token: string }>(
          `SELECT meeting_token FROM meetings
           WHERE customer_phone = $1
             AND company_id = $2
             AND status = 'pending'
             AND scheduled_at IS NULL
             AND created_at >= NOW() - INTERVAL '${REUSE_WINDOW_MINUTES} minutes'
           ORDER BY created_at DESC LIMIT 1`,
          [customerPhone, companyId],
        );
        if (existing.rows[0]?.meeting_token) {
          await client.query('COMMIT');
          logger.info(
            { phone: maskPhone(customerPhone) },
            'Reusing existing meeting token',
          );
          return { token: existing.rows[0].meeting_token, reused: true };
        }

        const token = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
        await client.query(
          `INSERT INTO meetings (customer_phone, meeting_link, meeting_token, token_expires_at, status, created_at, company_id)
           VALUES ($1, '', $2, $3, 'pending', NOW(), $4)`,
          [customerPhone, token, expiresAt, companyId],
        );
        await client.query('COMMIT');
        logger.info({ phone: maskPhone(customerPhone) }, 'Meeting token created');
        return { token, reused: false };
      }

      // Lock not acquired — another writer is mid-creation. Re-query so we
      // can return its token once committed, instead of leaving the caller
      // without a link.
      const last = await client.query<{ meeting_token: string }>(
        `SELECT meeting_token FROM meetings
         WHERE customer_phone = $1
           AND company_id = $2
           AND status = 'pending'
           AND scheduled_at IS NULL
           AND created_at >= NOW() - INTERVAL '${REUSE_WINDOW_MINUTES} minutes'
         ORDER BY created_at DESC LIMIT 1`,
        [customerPhone, companyId],
      );
      await client.query('COMMIT');
      if (last.rows[0]?.meeting_token) {
        logger.info(
          { phone: maskPhone(customerPhone) },
          'Advisory lock missed — reusing token',
        );
        return { token: last.rows[0].meeting_token, reused: true };
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error(
        { phone: maskPhone(customerPhone), attempt, err: (err as Error)?.message },
        'issueMeetingToken attempt failed',
      );
    } finally {
      client.release();
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(RETRY_SLEEP_MS);
    }
  }

  logger.error(
    { phone: maskPhone(customerPhone), companyId },
    'issueMeetingToken exhausted retries',
  );
  return null;
}
