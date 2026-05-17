/**
 * lib/meetings/createToken — integration test.
 *
 * Central invariant: two concurrent issueMeetingToken() calls for the
 * same (companyId, customerPhone) must produce ONE meetings row, with
 * the loser of the lock returning {reused: true} on the winner's token.
 *
 * Also verifies:
 *   - sequential second call within the 5-minute reuse window reuses
 *   - the inserted row has status='pending' + 24h-ish token_expires_at
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { hasDatabaseUrl, newTestPool } from '@/tests/helpers/db';
import { issueMeetingToken } from '@/lib/meetings/createToken';

const COMPANY_ID = 999_998;
const PHONE_PREFIX = '+testtoken';

describe.skipIf(!hasDatabaseUrl())('lib/meetings/createToken (integration)', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = newTestPool();
  });

  beforeEach(async () => {
    await pool.query(
      `DELETE FROM meetings WHERE customer_phone LIKE $1 OR company_id = $2`,
      [`${PHONE_PREFIX}%`, COMPANY_ID],
    );
  });

  afterEach(async () => {
    await pool.query(
      `DELETE FROM meetings WHERE customer_phone LIKE $1 OR company_id = $2`,
      [`${PHONE_PREFIX}%`, COMPANY_ID],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('first call inserts a fresh token (reused=false), 24h expiry', async () => {
    const phone = `${PHONE_PREFIX}-fresh`;
    const r = await issueMeetingToken({ companyId: COMPANY_ID, customerPhone: phone });
    expect(r).not.toBeNull();
    expect(r!.reused).toBe(false);
    const row = await pool.query<{
      status: string;
      meeting_token: string;
      token_expires_at: Date;
      created_at: Date;
    }>(
      `SELECT status, meeting_token, token_expires_at, created_at
       FROM meetings WHERE customer_phone = $1 AND company_id = $2`,
      [phone, COMPANY_ID],
    );
    expect(row.rows.length).toBe(1);
    expect(row.rows[0].status).toBe('pending');
    expect(row.rows[0].meeting_token).toBe(r!.token);
    const diffMs =
      new Date(row.rows[0].token_expires_at).getTime() -
      new Date(row.rows[0].created_at).getTime();
    // Should be approximately 24h (within 1 minute).
    expect(Math.abs(diffMs - 24 * 60 * 60 * 1000)).toBeLessThan(60_000);
  });

  it('sequential second call within the reuse window returns the same token', async () => {
    const phone = `${PHONE_PREFIX}-reuse`;
    const a = await issueMeetingToken({ companyId: COMPANY_ID, customerPhone: phone });
    const b = await issueMeetingToken({ companyId: COMPANY_ID, customerPhone: phone });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!.reused).toBe(true);
    expect(b!.token).toBe(a!.token);
  });

  it('concurrent calls produce ONE meetings row (advisory lock)', async () => {
    const phone = `${PHONE_PREFIX}-race`;
    const N = 5;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        issueMeetingToken({ companyId: COMPANY_ID, customerPhone: phone }),
      ),
    );
    for (const r of results) {
      expect(r).not.toBeNull();
    }
    const tokens = new Set(results.map((r) => r!.token));
    expect(tokens.size).toBe(1);
    const cnt = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM meetings WHERE customer_phone = $1`,
      [phone],
    );
    expect(Number(cnt.rows[0].c)).toBe(1);
    // Exactly one of the results is the fresh insert; the rest are reused.
    const fresh = results.filter((r) => r!.reused === false);
    expect(fresh.length).toBe(1);
  });
});
