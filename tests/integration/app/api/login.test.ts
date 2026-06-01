/**
 * Auth trial/active gates — integration test.
 *
 * Retargets the former app/api/login HTTP test. That endpoint was removed;
 * login is now Auth.js v5 signIn (credentials provider). The trial/active
 * invariant is enforced by two functions auth.ts delegates to:
 *
 *   - checkTrial      (lib/auth/trial.ts)    — throws on an expired trial.
 *       Called in BOTH authorize() (login) AND the session callback
 *       (mid-session). Maps to the old 402.
 *   - recheckIsActive (lib/auth/isActive.ts) — throws on a deactivated
 *       account. Called in the session callback. Maps to the old 403.
 *
 * We exercise those functions directly against a real Postgres: the trial
 * decision is computed in SQL from companies.created_at + config.trial_days,
 * so a mocked DB could not produce a genuine pass. A separate, DB-free
 * "wiring" check asserts auth.ts still calls checkTrial in BOTH call sites —
 * the "in both places" half of the invariant that a behavior test can't
 * prove on its own.
 *
 * Not retargeted: the old 401 (wrong password) is authorize()'s bcrypt
 * branch — plain Auth.js credential failure, not a trial/active gate, so it
 * has no standalone surface to assert here. The old 200 maps to "both gates
 * resolve", covered below.
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
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { hasDatabaseUrl, newTestPool } from '@/tests/helpers/db';
import { checkTrial } from '@/lib/auth/trial';
import { recheckIsActive } from '@/lib/auth/isActive';

const EMAIL_PREFIX = 'testlogin+';
const COMPANY_NAME_PREFIX = 'TestLoginCo-';
const PASSWORD = 'correct-horse-battery-staple';

describe.skipIf(!hasDatabaseUrl())('auth trial/active gates (integration)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = newTestPool();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM agents WHERE email LIKE $1`, [`${EMAIL_PREFIX}%`]);
    await pool.query(`DELETE FROM companies WHERE name LIKE $1`, [`${COMPANY_NAME_PREFIX}%`]);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM agents WHERE email LIKE $1`, [`${EMAIL_PREFIX}%`]);
    await pool.query(`DELETE FROM companies WHERE name LIKE $1`, [`${COMPANY_NAME_PREFIX}%`]);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function makeCompany(opts: { trialExpired?: boolean } = {}): Promise<number> {
    const name = `${COMPANY_NAME_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = opts.trialExpired
      ? "NOW() - INTERVAL '90 days'"
      : 'NOW()';
    // webhook_secret is NOT NULL on companies — seed a unique throwaway.
    const webhookSecret = `whsec_test_${Math.random().toString(36).slice(2)}`;
    const r = await pool.query<{ id: number }>(
      `INSERT INTO companies (name, is_active, created_at, webhook_secret)
       VALUES ($1, TRUE, ${createdAt}, $2) RETURNING id`,
      [name, webhookSecret],
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

  // ── checkTrial (old 402) — the gate run in BOTH authorize() and session ──
  it('checkTrial resolves for an active, in-trial company (old 200 path)', async () => {
    const cid = await makeCompany();
    await expect(checkTrial(cid)).resolves.toBeUndefined();
  });

  it('checkTrial throws for an expired-trial company (old 402)', async () => {
    const cid = await makeCompany({ trialExpired: true });
    await expect(checkTrial(cid)).rejects.toThrow(/trial expired/i);
  });

  it('checkTrial is a no-op for a null companyId (no tenant → no gate)', async () => {
    await expect(checkTrial(null)).resolves.toBeUndefined();
  });

  // ── recheckIsActive (old 403) — the gate run in the session callback ──
  it('recheckIsActive resolves for an active agent (old 200 path)', async () => {
    const cid = await makeCompany();
    const id = await makeAgent({
      email: `${EMAIL_PREFIX}active-${Date.now()}@test.local`,
      companyId: cid,
      isActive: true,
    });
    await expect(recheckIsActive(id)).resolves.toBeUndefined();
  });

  it('recheckIsActive throws for a deactivated agent (old 403)', async () => {
    const cid = await makeCompany();
    const id = await makeAgent({
      email: `${EMAIL_PREFIX}deact-${Date.now()}@test.local`,
      companyId: cid,
      isActive: false,
    });
    await expect(recheckIsActive(id)).rejects.toThrow(/deactivated/i);
  });
});

// ── Wiring guard (no DB): the invariant requires checkTrial in BOTH the
//    authorize() callback and the session callback. A behavior test can't
//    prove the call sites exist, so assert it against auth.ts source. This
//    runs even without a DATABASE_URL, so the "both sites" clause is always
//    checked. (Reads the file as text — does not import/initialize Auth.js.)
describe('auth.ts wires checkTrial into both call sites', () => {
  const src = readFileSync(path.resolve(process.cwd(), 'auth.ts'), 'utf8');

  it('calls checkTrial inside authorize()', () => {
    const authorizeStart = src.indexOf('authorize:');
    const callbacksStart = src.indexOf('callbacks:');
    expect(authorizeStart).toBeGreaterThan(-1);
    expect(callbacksStart).toBeGreaterThan(authorizeStart);
    const authorizeBody = src.slice(authorizeStart, callbacksStart);
    expect(authorizeBody).toContain('checkTrial(');
  });

  it('calls checkTrial inside the session callback', () => {
    const sessionStart = src.indexOf('async session(');
    expect(sessionStart).toBeGreaterThan(-1);
    const sessionBody = src.slice(sessionStart);
    expect(sessionBody).toContain('checkTrial(');
  });
});
