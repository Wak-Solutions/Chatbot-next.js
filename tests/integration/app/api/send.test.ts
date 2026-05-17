/**
 * app/api/send — integration test.
 *
 * Verifies the agent-send route:
 *   - 401 without a session
 *   - 200 + 1 outbound row with sender='agent' on the happy path
 *   - Two concurrent sends share ONE conversation_id (advisory lock)
 *   - 502 when Meta returns 4xx
 *
 * Mocks @/lib/companies/creds → fake creds, and global.fetch → stand-in
 * for the Meta Cloud API. Real DB + real session.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';
import { hasDatabaseUrl, newTestPool } from '@/tests/helpers/db';
import {
  SESSION_COOKIE_NAME,
  generateSid,
  writeSession,
  type SessionData,
} from '@/lib/auth/session';
import { signSidFromEnv } from '@/lib/auth/cookies';

const getCredsMock = vi.hoisted(() =>
  vi.fn<(companyId: number) => Promise<{ token: string; phoneId: string } | null>>(),
);
const invalidateCredsMock = vi.hoisted(() => vi.fn<() => void>());

vi.mock('@/lib/companies/creds', () => ({
  getWhatsappCreds: getCredsMock,
  invalidateWhatsappCreds: invalidateCredsMock,
}));

const { POST } = await import('@/app/api/send/route');

const COMPANY_ID = 999_996;
const PHONE_PREFIX = '+testsend';
const AGENT_NAME = 'TestSendAgent';

describe.skipIf(!hasDatabaseUrl())('app/api/send (integration)', () => {
  let pool: Pool;
  let originalFetch: typeof fetch;

  beforeAll(() => {
    pool = newTestPool();
  });

  beforeEach(async () => {
    originalFetch = global.fetch;
    getCredsMock.mockReset();
    getCredsMock.mockResolvedValue({ token: 'test-token', phoneId: 'test-phone-id' });
    invalidateCredsMock.mockReset();
    await pool.query(
      `DELETE FROM messages WHERE customer_phone LIKE $1 OR company_id = $2`,
      [`${PHONE_PREFIX}%`, COMPANY_ID],
    );
    await pool.query(`DELETE FROM agents WHERE name = $1`, [AGENT_NAME]);
    await pool.query(`DELETE FROM session WHERE sid LIKE 'test-send-%'`);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await pool.query(
      `DELETE FROM messages WHERE customer_phone LIKE $1 OR company_id = $2`,
      [`${PHONE_PREFIX}%`, COMPANY_ID],
    );
    await pool.query(`DELETE FROM agents WHERE name = $1`, [AGENT_NAME]);
  });

  afterAll(async () => {
    await pool.end();
  });

  /** Seeds an agent row and writes a real session row, returning the
   * signed connect.sid cookie value + csrf token. */
  async function authedSession(): Promise<{ cookie: string; csrf: string; agentId: number }> {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO agents (name, email, password_hash, role, is_active, company_id)
       VALUES ($1, NULL, 'unused', 'agent', TRUE, $2) RETURNING id`,
      [AGENT_NAME, COMPANY_ID],
    );
    const agentId = r.rows[0].id;
    const sid = generateSid();
    const csrf = 'test-csrf-token-deadbeef';
    const session: SessionData = {
      authenticated: true,
      agentId,
      companyId: COMPANY_ID,
      role: 'agent',
      agentName: AGENT_NAME,
      isActive: true,
      lastActiveCheck: Date.now(),
      csrfToken: csrf,
    };
    await writeSession(sid, session);
    return { cookie: signSidFromEnv(sid), csrf, agentId };
  }

  function makeReq(opts: {
    cookie?: string;
    csrf?: string;
    body: object;
  }): NextRequest {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (opts.cookie) headers['cookie'] = `${SESSION_COOKIE_NAME}=${opts.cookie}`;
    if (opts.csrf) headers['x-csrf-token'] = opts.csrf;
    return new NextRequest('http://localhost/api/send', {
      method: 'POST',
      headers,
      body: JSON.stringify(opts.body),
    });
  }

  it('unauthenticated → 401', async () => {
    const res = await POST(
      makeReq({ body: { customer_phone: `${PHONE_PREFIX}-401`, message: 'hi' } }),
      undefined,
    );
    expect(res.status).toBe(401);
  });

  it('authed happy path → 200 + outbound row with sender=agent', async () => {
    const { cookie, csrf } = await authedSession();
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'meta-1' }] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const phone = `${PHONE_PREFIX}-happy`;
    const res = await POST(
      makeReq({ cookie, csrf, body: { customer_phone: phone, message: 'hello' } }),
      undefined,
    );
    expect(res.status).toBe(200);
    const rows = await pool.query<{ sender: string; direction: string; message_text: string }>(
      `SELECT sender, direction, message_text FROM messages WHERE customer_phone = $1`,
      [phone],
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].sender).toBe('agent');
    expect(rows.rows[0].direction).toBe('outbound');
    expect(rows.rows[0].message_text).toBe('hello');
  });

  it('concurrent sends share ONE conversation_id (advisory lock)', async () => {
    const { cookie, csrf } = await authedSession();
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'meta-x' }] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const phone = `${PHONE_PREFIX}-race`;
    const N = 4;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        POST(
          makeReq({
            cookie,
            csrf,
            body: { customer_phone: phone, message: `msg ${i}` },
          }),
          undefined,
        ),
      ),
    );
    const r = await pool.query<{ conversation_id: string | null }>(
      `SELECT DISTINCT conversation_id FROM messages WHERE customer_phone = $1`,
      [phone],
    );
    const distinct = new Set(r.rows.map((x) => x.conversation_id).filter(Boolean));
    expect(distinct.size).toBe(1);
    const c = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM messages WHERE customer_phone = $1`,
      [phone],
    );
    expect(Number(c.rows[0].c)).toBe(N);
  });

  it('Meta 400 → 502 to caller + no row inserted', async () => {
    const { cookie, csrf } = await authedSession();
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 131047 } }), { status: 400 }),
    ) as unknown as typeof fetch;

    const phone = `${PHONE_PREFIX}-meta-fail`;
    const res = await POST(
      makeReq({ cookie, csrf, body: { customer_phone: phone, message: 'oops' } }),
      undefined,
    );
    expect(res.status).toBe(502);
    const rows = await pool.query(
      `SELECT 1 FROM messages WHERE customer_phone = $1`,
      [phone],
    );
    expect(rows.rows.length).toBe(0);
  });
});
