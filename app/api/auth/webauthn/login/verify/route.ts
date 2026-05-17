/**
 * POST /api/auth/webauthn/login/verify — port of
 * server/routes/auth.routes.ts:320-427.
 *
 * Public. Verifies a WebAuthn assertion, performs the same gate checks as
 * the password login (is_active, no companyId, trial), updates the
 * stored counter to whatever the authenticator reports (platform
 * authenticators report 0 — storing that prevents drift), then rotates
 * the session and sets connect.sid + csrf-token cookies.
 *
 * On RP-ID / origin mismatch the response carries the WEBAUTHN_RP_MISMATCH
 * code so PR 10's login page can show its re-registration CTA.
 *
 * Rate limit: authEntryLimiter (20 / 15 min / IP) — matches
 * routes.ts:120 (app.use('/api/auth/webauthn/login/verify', authLimiter)).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import {
  SESSION_COOKIE_NAME,
  generateSid,
  readSession,
  sessionCookieAttrs,
  writeSession,
  destroySession,
  type SessionData,
} from '@/lib/auth/session';
import { signSidFromEnv, verifySidFromEnv } from '@/lib/auth/cookies';
import { setCsrfCookie, CSRF_COOKIE_NAME } from '@/lib/auth/csrf';
import { getCompanyTrialStatus } from '@/lib/auth/trial';
import {
  verifyAuthentication,
  deriveRpFromRequest,
} from '@/lib/auth/webauthn';
import { authEntryLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('auth');

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function rpHints(request: NextRequest) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto');
  return {
    hostname: url.hostname,
    protocol: forwardedProto ?? url.protocol.replace(/:$/, ''),
  };
}

interface CredentialRow {
  credential_id: string;
  public_key: string;
  counter: string | number;
  agent_id: number;
  company_id: number | null;
  agent_name: string | null;
  role: string;
  is_active: boolean | null;
  terms_accepted_at: Date | null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ipDecision = authEntryLimiter.check(`wa:${clientIp(request)}`);
  if (!ipDecision.ok) {
    return NextResponse.json(
      { message: 'Too many requests, please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(ipDecision.retryAfterMs / 1000)) },
      },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: 'Invalid request body' }, { status: 400 });
  }
  const credentialId = typeof body.id === 'string' ? body.id : '';

  try {
    const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!raw) {
      return NextResponse.json({ message: 'No pending login challenge' }, { status: 400 });
    }
    const oldSid = verifySidFromEnv(raw);
    if (!oldSid) {
      return NextResponse.json({ message: 'No pending login challenge' }, { status: 400 });
    }
    const record = await readSession(oldSid);
    const challenge = record?.data.webauthnChallenge;
    if (!challenge) {
      return NextResponse.json({ message: 'No pending login challenge' }, { status: 400 });
    }

    const credRow = await getPool().query<CredentialRow>(
      `SELECT wc.credential_id, wc.public_key, wc.counter,
              a.id AS agent_id, a.company_id, a.name AS agent_name, a.role, a.is_active,
              a.terms_accepted_at
       FROM webauthn_credentials wc
       JOIN agents a ON a.id = wc.agent_id
       WHERE wc.credential_id = $1`,
      [credentialId],
    );
    if (credRow.rows.length === 0) {
      logger.warn({ credentialId }, 'WebAuthn login — credential not found');
      return NextResponse.json({ message: 'Credential not registered' }, { status: 401 });
    }
    const stored = credRow.rows[0];
    if (!stored.is_active) {
      return NextResponse.json(
        { message: 'Your account has been deactivated.' },
        { status: 403 },
      );
    }
    if (!stored.company_id) {
      logger.error({ agentId: stored.agent_id }, 'WebAuthn login — agent has no company_id');
      return NextResponse.json(
        { message: 'Account configuration error. Please contact support.' },
        { status: 403 },
      );
    }

    const trial = await getCompanyTrialStatus(stored.company_id);
    if (trial.expired) {
      logger.warn(
        { agentId: stored.agent_id, companyId: stored.company_id },
        'WebAuthn login blocked — trial expired',
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

    const rp = deriveRpFromRequest(rpHints(request));
    const result = await verifyAuthentication({
      rp,
      expectedChallenge: challenge,
      response: body as never,
      credential: {
        id: stored.credential_id,
        publicKey: new Uint8Array(Buffer.from(stored.public_key, 'hex')),
        counter: Number(stored.counter),
      },
    });

    if (!result.ok) {
      logger.warn({ code: result.code }, 'WebAuthn login verification failed');
      const status = result.code === 'WEBAUTHN_NO_CHALLENGE' ? 400 : 401;
      return NextResponse.json(
        { message: 'Biometric verification failed', code: result.code },
        { status },
      );
    }

    await getPool().query(
      'UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2',
      [result.info.authenticationInfo.newCounter, stored.credential_id],
    );

    const termsAcceptedAt = stored.terms_accepted_at
      ? new Date(stored.terms_accepted_at).toISOString()
      : null;

    const session: SessionData = {
      authenticated: true,
      agentId: stored.agent_id,
      companyId: stored.company_id,
      role: stored.role,
      agentName: stored.agent_name ?? undefined,
      isActive: true,
      lastActiveCheck: Date.now(),
      termsAcceptedAt,
    };
    const csrf = setCsrfCookie(session);

    // Rotate sid (fixation mitigation, matches regenerate() at auth.routes.ts:389).
    await destroySession(oldSid);
    const sid = generateSid();
    await writeSession(sid, session);

    const response = NextResponse.json({
      success: true,
      authenticated: true,
      role: stored.role,
      agentId: stored.agent_id,
      agentName: stored.agent_name,
      termsAcceptedAt,
    });
    response.cookies.set(SESSION_COOKIE_NAME, signSidFromEnv(sid), sessionCookieAttrs());
    response.cookies.set(CSRF_COOKIE_NAME, csrf.value, csrf.options);
    logger.info(
      { agentId: stored.agent_id, companyId: stored.company_id },
      'WebAuthn login success',
    );
    return response;
  } catch (err) {
    logger.error(
      { credentialId: credentialId || '(none)', err: (err as Error)?.message },
      'WebAuthn login verify error',
    );
    return NextResponse.json({ message: 'Biometric authentication failed' }, { status: 401 });
  }
}
