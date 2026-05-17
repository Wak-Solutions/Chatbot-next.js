/**
 * lib/messaging/memory — integration test against a real Postgres.
 *
 * The central invariant: under concurrent saveMessage() calls for the
 * same (customerPhone, companyId), the pg_advisory_xact_lock dance must
 * mint exactly ONE conversation_id, not N. This is the cross-writer
 * race the legacy memory.py was actively reproducing in prod.
 *
 * Other checks:
 *   - loadHistory returns empty for a fresh phone
 *   - saveMessage('inbound') triggers autoCaptureContact
 *   - getConversationId mirrors what saveMessage minted
 *
 * Skips when DATABASE_URL is unset (local dev convenience).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { hasDatabaseUrl, newTestPool } from '@/tests/helpers/db';
import {
  getConversationId,
  loadHistory,
  saveMessage,
} from '@/lib/messaging/memory';

const COMPANY_ID = 999_999;
const PHONE_PREFIX = '+testmemory';

describe.skipIf(!hasDatabaseUrl())('lib/messaging/memory (integration)', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = newTestPool();
  });

  beforeEach(async () => {
    // Per-test cleanup: delete only the rows our fixtures own.
    await pool.query(
      `DELETE FROM messages WHERE customer_phone LIKE $1 OR company_id = $2`,
      [`${PHONE_PREFIX}%`, COMPANY_ID],
    );
    await pool.query(
      `DELETE FROM contact_companies WHERE company_id = $1`,
      [COMPANY_ID],
    );
    await pool.query(
      `DELETE FROM contacts WHERE phone_number LIKE $1`,
      [`${PHONE_PREFIX}%`],
    );
  });

  afterEach(async () => {
    await pool.query(
      `DELETE FROM messages WHERE customer_phone LIKE $1 OR company_id = $2`,
      [`${PHONE_PREFIX}%`, COMPANY_ID],
    );
    await pool.query(
      `DELETE FROM contact_companies WHERE company_id = $1`,
      [COMPANY_ID],
    );
    await pool.query(
      `DELETE FROM contacts WHERE phone_number LIKE $1`,
      [`${PHONE_PREFIX}%`],
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('loadHistory returns [] for a fresh phone', async () => {
    const h = await loadHistory(`${PHONE_PREFIX}-fresh`, COMPANY_ID);
    expect(h).toEqual([]);
  });

  it('saveMessage(inbound) auto-captures the contact', async () => {
    const phone = `${PHONE_PREFIX}-capture`;
    await saveMessage({
      customerPhone: phone,
      companyId: COMPANY_ID,
      direction: 'inbound',
      messageText: 'hi',
    });
    const c = await pool.query<{ id: number }>(
      `SELECT id FROM contacts WHERE phone_number = $1`,
      [phone],
    );
    expect(c.rows.length).toBe(1);
    const cc = await pool.query(
      `SELECT 1 FROM contact_companies WHERE contact_id = $1 AND company_id = $2`,
      [c.rows[0].id, COMPANY_ID],
    );
    expect(cc.rows.length).toBe(1);
  });

  it('roundtrip: saveMessage then loadHistory shows the row mapped to OpenAI roles', async () => {
    const phone = `${PHONE_PREFIX}-rt`;
    await saveMessage({
      customerPhone: phone,
      companyId: COMPANY_ID,
      direction: 'inbound',
      messageText: 'customer says hi',
    });
    await saveMessage({
      customerPhone: phone,
      companyId: COMPANY_ID,
      direction: 'outbound',
      messageText: 'bot replies',
    });
    const h = await loadHistory(phone, COMPANY_ID);
    expect(h).toEqual([
      { role: 'user', content: 'customer says hi' },
      { role: 'assistant', content: 'bot replies' },
    ]);
  });

  it('concurrent saveMessage for same phone produces ONE conversation_id', async () => {
    const phone = `${PHONE_PREFIX}-race`;
    const N = 5;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        saveMessage({
          customerPhone: phone,
          companyId: COMPANY_ID,
          direction: 'inbound',
          messageText: `msg ${i}`,
        }),
      ),
    );
    const r = await pool.query<{ conversation_id: string | null }>(
      `SELECT DISTINCT conversation_id FROM messages
       WHERE customer_phone = $1 AND company_id = $2`,
      [phone, COMPANY_ID],
    );
    const distinct = new Set(r.rows.map((x) => x.conversation_id).filter(Boolean));
    expect(distinct.size).toBe(1);
    // and there should be N rows
    const cnt = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM messages WHERE customer_phone = $1`,
      [phone],
    );
    expect(Number(cnt.rows[0].c)).toBe(N);
  });

  it('getConversationId returns the same id saveMessage minted', async () => {
    const phone = `${PHONE_PREFIX}-getconv`;
    await saveMessage({
      customerPhone: phone,
      companyId: COMPANY_ID,
      direction: 'inbound',
      messageText: 'hello',
    });
    const got = await getConversationId(phone, COMPANY_ID);
    expect(got).not.toBeNull();
    const r = await pool.query<{ conversation_id: string }>(
      `SELECT conversation_id FROM messages
       WHERE customer_phone = $1 LIMIT 1`,
      [phone],
    );
    expect(got).toBe(r.rows[0].conversation_id);
  });
});
