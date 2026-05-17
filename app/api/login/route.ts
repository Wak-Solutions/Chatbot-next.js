/**
 * POST /api/login — port of server/routes/auth.routes.ts:78-159.
 *
 * Flow:
 *   1. Validate identifier + password presence (400 on missing).
 *   2. Look up agent by email OR phone.
 *   3. is_active === false → 403 with the original `error` key shape.
 *   4. bcrypt compare against password_hash (401 on mismatch).
 *   5. Trial gate via getCompanyTrialStatus (402 with full payload).
 *   6. UPDATE agents.last_login.
 *   7. Generate a fresh sid (session-fixation mitigation; equivalent of
 *      express-session's regenerate()), writeSession with all the keys
 *      auth.routes.ts:129-136 sets, then attach signed connect.sid and
 *      csrf-token cookies to the response.
 *
 * Error envelopes match the original verbatim — note the inconsistent use
 * of `message` vs `error` keys (deactivated path uses `error`).
 *
 * Rate limit: authEntryLimiter (20 / 15 min / IP). Applied at the IP layer
 * by routes.ts:119 in the legacy stack; we run the same check here.
 */

import bcrypt from 'bcrypt';
import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import {
  SESSION_COOKIE_NAME,
  generateSid,
  writeSession,
  sessionCookieAttrs,
  type SessionData,
} from '@/lib/auth/session';
import { signSidFromEnv } from '@/lib/auth/cookies';
import { setCsrfCookie, CSRF_COOKIE_NAME } from '@/lib/auth/csrf';
import { getCompanyTrialStatus } from '@/lib/auth/trial';
import { authEntryLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('auth');

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

interface AgentRow {
  id: number;
  name: string | null;
  email: string | null;
  password_hash: string;
  role: string;
  company_id: number | null;
  is_active: boolean | null;
  terms_accepted_at: Date | null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ipDecision = authEntryLimiter.check(`login:${clientIp(request)}`);
  if (!ipDecision.ok) {
    return NextResponse.json(
      { message: 'Too many requests, please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(ipDecision.retryAfterMs / 1000)) },
      },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Email/phone and password are required' }, { status: 400 });
  }
  const identifier = typeof body.email === 'string' ? body.email : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!identifier || !password) {
    return NextResponse.json({ message: 'Email/phone and password are required' }, { status: 400 });
  }

  try {
    const agentRes = await getPool().query<AgentRow>(
      `SELECT * FROM agents WHERE lower(email)=lower($1) OR phone=$1 LIMIT 1`,
      [identifier],
    );
    if (agentRes.rows.length === 0) {
      logger.warn(
        { identifier: identifier.replace(/^[^@]+/, '***') },
        'Login failed — agent not found',
      );
      return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
    }
    const agent = agentRes.rows[0];
    if (agent.is_active === false) {
      logger.warn(
        { identifier: identifier.replace(/^[^@]+/, '***') },
        'Login rejected — account deactivated',
      );
      return NextResponse.json(
        { error: 'Your account has been deactivated. Please contact your administrator.' },
        { status: 403 },
      );
    }
    const valid = await bcrypt.compare(password, agent.password_hash);
    if (!valid) {
      logger.warn(
        { identifier: identifier.replace(/^[^@]+/, '***') },
        'Login failed — wrong password',
      );
      return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
    }

    if (agent.company_id) {
      const trial = await getCompanyTrialStatus(agent.company_id);
      if (trial.expired) {
        logger.warn(
          { agentId: agent.id, companyId: agent.company_id },
          'Login blocked — trial expired',
        );
        return NextResponse.json(
          {
            message: 'Your free trial has expired. Please contact support to continue.',
            trialExpired: true,
            trialDays: trial.trialDays,
            expiresAt: trial.expiresAt,
          },
          { status: 402 },
        );
      }
    }

    const termsAcceptedAt = agent.terms_accepted_at
      ? new Date(agent.terms_accepted_at).toISOString()
      : null;

    await getPool().query('UPDATE agents SET last_login=NOW() WHERE id=$1', [agent.id]);

    const session: SessionData = {
      authenticated: true,
      agentId: agent.id,
      companyId: agent.company_id,
      role: agent.role,
      agentName: agent.name ?? undefined,
      isActive: true,
      lastActiveCheck: Date.now(),
      termsAcceptedAt,
    };
    const csrf = setCsrfCookie(session);

    const sid = generateSid();
    await writeSession(sid, session);

    const response = NextResponse.json({
      success: true,
      authenticated: true,
      role: agent.role,
      agentId: agent.id,
      agentName: agent.name,
      termsAcceptedAt,
    });
    response.cookies.set(SESSION_COOKIE_NAME, signSidFromEnv(sid), sessionCookieAttrs());
    response.cookies.set(CSRF_COOKIE_NAME, csrf.value, csrf.options);
    logger.info({ agentId: agent.id, role: agent.role }, 'Login success');
    return response;
  } catch (err) {
    logger.error(
      { identifier: identifier?.replace(/^[^@]+/, '***') ?? '***', err: (err as Error)?.message },
      'Login error',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}
