/**
 * POST /api/register — port of server/routes/register.routes.ts:79-182.
 *
 * Step 1 of onboarding. Public. Rate-limited via authEntryLimiter.
 *
 * Transaction:
 *   companies      INSERT  (name, email, phone, onboarding_step=2,
 *                           webhook_secret, brand_name, app_url)
 *   subscriptions  INSERT  (plan='trial', status='trial',
 *                           trial_ends_at=NOW()+14d)
 *   agents         INSERT  (name, email, phone, password_hash, role='admin',
 *                           company_id, is_active=true)
 *   chatbot_config INSERT  (system_prompt='', override_active=false,
 *                           company_id)
 *
 * After commit, creates a fresh session with the same keys the original
 * Express handler writes (lines 150-155) and sets connect.sid + csrf-token
 * cookies on the response.
 */

import bcrypt from 'bcrypt';
import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import {
  SESSION_COOKIE_NAME,
  generateSid,
  sessionCookieAttrs,
  writeSession,
  type SessionData,
} from '@/lib/auth/session';
import { signSidFromEnv } from '@/lib/auth/cookies';
import { setCsrfCookie, CSRF_COOKIE_NAME } from '@/lib/auth/csrf';
import { authEntryLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('register');

const RegisterStep1Schema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(255).optional().or(z.literal('')),
  phone: z.string().regex(/^\+?[0-9]{7,15}$/),
  password: z.string().min(8).max(128),
});

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  // Trust the RIGHTMOST X-Forwarded-For value. Railway terminates TLS at
  // exactly one proxy hop before the container, so the real client IP is
  // appended at the right end of the chain. Values on the left are
  // attacker-controlled — taking the leftmost lets a single client rotate
  // the key per request and defeat per-IP rate limits.
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ipDecision = authEntryLimiter.check(`register:${clientIp(request)}`);
  if (!ipDecision.ok) {
    return NextResponse.json(
      { message: 'Too many requests, please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(ipDecision.retryAfterMs / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }
  const parsed = RegisterStep1Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }
  const { firstName, lastName, email, password, phone } = parsed.data;

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (email) {
      const emailCheck = await client.query('SELECT id FROM agents WHERE email = $1', [email]);
      if (emailCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 },
        );
      }
    }

    const phoneCheck = await client.query('SELECT id FROM agents WHERE phone = $1', [phone]);
    if (phoneCheck.rows.length > 0) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'An account with this mobile number already exists' },
        { status: 409 },
      );
    }

    const companyName = `${firstName} ${lastName}'s Company`;
    const appUrl = process.env.APP_URL || request.headers.get('origin') || '';
    const companyRes = await client.query<{ id: number }>(
      `INSERT INTO companies (name, email, phone, onboarding_step, webhook_secret, brand_name, app_url)
       VALUES ($1, $2, $3, 2, encode(gen_random_bytes(32), 'hex'), $1, $4)
       RETURNING id`,
      [companyName, email || null, phone, appUrl],
    );
    const companyId = companyRes.rows[0].id;

    await client.query(
      `INSERT INTO subscriptions (company_id, plan, status, trial_ends_at)
       VALUES ($1, 'trial', 'trial', NOW() + INTERVAL '14 days')`,
      [companyId],
    );

    const hash = await bcrypt.hash(password, 10);
    const agentRes = await client.query<{ id: number }>(
      `INSERT INTO agents (name, email, phone, password_hash, role, company_id, is_active)
       VALUES ($1, $2, $3, $4, 'admin', $5, true)
       RETURNING id`,
      [`${firstName} ${lastName}`, email || null, phone, hash, companyId],
    );
    const agentId = agentRes.rows[0].id;

    await client.query(
      `INSERT INTO chatbot_config (system_prompt, override_active, company_id)
       VALUES ('', false, $1)`,
      [companyId],
    );

    await client.query('COMMIT');

    const session: SessionData = {
      authenticated: true,
      agentId,
      companyId,
      role: 'admin',
      agentName: `${firstName} ${lastName}`,
      isActive: true,
      lastActiveCheck: Date.now(),
      termsAcceptedAt: null,
    };
    const csrf = setCsrfCookie(session);

    const sid = generateSid();
    await writeSession(sid, session);

    const response = NextResponse.json({ success: true, companyId, agentId });
    response.cookies.set(SESSION_COOKIE_NAME, signSidFromEnv(sid), sessionCookieAttrs());
    response.cookies.set(CSRF_COOKIE_NAME, csrf.value, csrf.options);
    logger.info({ companyId, agentId }, 'Registration complete');
    return response;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    const pgErr = err as { code?: string; constraint?: string; message?: string };
    if (pgErr.code === '23505' && pgErr.constraint === 'agents_phone_uniq') {
      return NextResponse.json(
        { error: 'An account with this phone number already exists.' },
        { status: 409 },
      );
    }
    if (
      pgErr.code === '23505' &&
      (pgErr.constraint === 'companies_pkey' || pgErr.constraint === 'agents_pkey')
    ) {
      logger.warn({ constraint: pgErr.constraint }, 'PK collision on registration — resyncing sequences');
      await pool.query(`SELECT setval('companies_id_seq', (SELECT MAX(id) FROM companies), true)`).catch(() => {});
      await pool.query(`SELECT setval('agents_id_seq',   (SELECT MAX(id) FROM agents),    true)`).catch(() => {});
      return NextResponse.json(
        { error: 'Registration temporarily unavailable. Please try again.' },
        { status: 503 },
      );
    }
    logger.error({ err: pgErr.message }, 'Registration failed');
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 });
  } finally {
    client.release();
  }
}
