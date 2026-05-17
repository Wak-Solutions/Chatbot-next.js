/**
 * app/api/login — integration test.
 *
 * Exercises the four key response codes through the real handler:
 *   200 — valid creds → success + connect.sid cookie set
 *   401 — wrong password
 *   403 — is_active = false (deactivated account)
 *   402 — trial expired (created_at older than trial_days)
 *
 * Hits a real Postgres via DATABASE_URL. Each test seeds its own agent
 * + company, runs the handler, asserts on the NextResponse, and cleans
 * up by deleting only its own fixtures.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { NextRequest } from 'next/server';
import { hasDatabaseUrl, newTestPool } from '@/tests/helpers/db';

const EMAIL_PREFIX = 'testlogin+';
const COMPANY_NAME_PREFIX = 'TestLoginCo-';
const PASSWORD = 'correct-horse-battery-staple';

describe.skipIf(!hasDatabaseUrl())('app/api/login (integration)', () => {
  let pool: Pool;
  let POST: (req: NextRequest) => Promise<Response>;

  beforeAll(() => {
    pool = newTestPool();
  });

  beforeEach(async () => {
    // Re-import per test so the route handler picks up env (notably
    // SESSION_SECRET from tests/helpers/setup.ts).
    const mod = await import('@/app/api/login/route');
    POST = mod.POST as unknown as (req: NextRequest) => Promise<Response>;
    // Clean up any leftover fixtures from prior runs.
    await pool.query(`DELETE FROM agents WHERE email LIKE $1`, [
      `${EMAIL_PREFIX}%`,
    ]);
    await pool.query(`DELETE FROM companies WHERE name LIKE $1`, [
      `${COMPANY_NAME_PREFIX}%`,
    ]);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM agents WHERE email LIKE $1`, [
      `${EMAIL_PREFIX}%`,
    ]);
    await pool.query(`DELETE FROM companies WHERE name LIKE $1`, [
      `${COMPANY_NAME_PREFIX}%`,
    ]);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function makeCompany(opts: { trialExpired?: boolean } = {}): Promise<number> {
    const name = `${COMPANY_NAME_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = opts.trialExpired
      ? "NOW() - INTERVAL '90 days'"
      : 'NOW()';
    const r = await pool.query<{ id: number }>(
      `INSERT INTO companies (name, is_active, created_at) VALUES ($1, TRUE, ${createdAt}) RETURNING id`,
      [name],
    );
    return r.rows[0].id;
  }

  async function makeAgent(opts: {
    email: string;
    companyId: number;
    isActive: boolean;
  }): Promise<number> {
    const hash = await bcrypt.hash(PASSWORD, 4);
    const r = await pool.query<{ id: number }>(
      `INSERT INTO agents (name, email, password_hash, role, is_active, company_id)
       VALUES ('Test Agent', $1, $2, 'agent', $3, $4) RETURNING id`,
      [opts.email, hash, opts.isActive, opts.companyId],
    );
    return r.rows[0].id;
  }

  function makeReq(email: string, password: string): NextRequest {
    return new NextRequest('http://localhost/api/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': `127.0.0.${Math.floor(Math.random() * 250) + 1}`,
      },
      body: JSON.stringify({ email, password }),
    });
  }

  it('valid creds → 200 + connect.sid cookie set', async () => {
    const cid = await makeCompany();
    const email = `${EMAIL_PREFIX}happy-${Date.now()}@test.local`;
    await makeAgent({ email, companyId: cid, isActive: true });
    const res = await POST(makeReq(email, PASSWORD));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('connect.sid=');
    const body = (await res.json()) as { success: boolean; authenticated: boolean };
    expect(body.success).toBe(true);
    expect(body.authenticated).toBe(true);
  });

  it('wrong password → 401', async () => {
    const cid = await makeCompany();
    const email = `${EMAIL_PREFIX}badpwd-${Date.now()}@test.local`;
    await makeAgent({ email, companyId: cid, isActive: true });
    const res = await POST(makeReq(email, 'wrong-password'));
    expect(res.status).toBe(401);
  });

  it('deactivated account (is_active = FALSE) → 403 with error key', async () => {
    const cid = await makeCompany();
    const email = `${EMAIL_PREFIX}deact-${Date.now()}@test.local`;
    await makeAgent({ email, companyId: cid, isActive: false });
    const res = await POST(makeReq(email, PASSWORD));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBeDefined();
  });

  it('trial expired (created_at older than trial_days) → 402', async () => {
    const cid = await makeCompany({ trialExpired: true });
    const email = `${EMAIL_PREFIX}trial-${Date.now()}@test.local`;
    await makeAgent({ email, companyId: cid, isActive: true });
    const res = await POST(makeReq(email, PASSWORD));
    expect(res.status).toBe(402);
    const body = (await res.json()) as { trialExpired?: boolean };
    expect(body.trialExpired).toBe(true);
  });
});
