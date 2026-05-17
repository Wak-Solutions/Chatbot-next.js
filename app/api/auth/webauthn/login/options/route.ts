/**
 * POST /api/auth/webauthn/login/options — port of
 * server/routes/auth.routes.ts:288-317.
 *
 * Public. Scoped to a single email so we never return a cross-tenant
 * credential inventory. Same envelope shape regardless of whether the
 * email exists (no account enumeration via missing vs empty
 * allowCredentials).
 *
 * Stores the issued challenge in the caller's session so the paired
 * verify endpoint can match it. The session is created lazily when one
 * doesn't already exist.
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
  type SessionData,
} from '@/lib/auth/session';
import { signSidFromEnv, verifySidFromEnv } from '@/lib/auth/cookies';
import {
  buildAuthenticationOptions,
  deriveRpFromRequest,
} from '@/lib/auth/webauthn';

const logger = createLogger('auth');

export const dynamic = 'force-dynamic';

function rpHints(request: NextRequest) {
  const url = new URL(request.url);
  const forwardedProto = request.headers.get('x-forwarded-proto');
  return {
    hostname: url.hostname,
    protocol: forwardedProto ?? url.protocol.replace(/:$/, ''),
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let bodyEmail = '';
  try {
    const body = await request.json();
    if (typeof body?.email === 'string') bodyEmail = body.email.trim();
  } catch {
    // empty body is OK — equivalent to "no email scoping"
  }

  try {
    let allowCredentialIds: string[] = [];
    if (bodyEmail) {
      const result = await getPool().query<{ credential_id: string }>(
        `SELECT wc.credential_id FROM webauthn_credentials wc
         JOIN agents a ON a.id = wc.agent_id
         WHERE lower(a.email) = lower($1) AND a.is_active = true`,
        [bodyEmail],
      );
      allowCredentialIds = result.rows.map((r) => r.credential_id);
    }

    const rp = deriveRpFromRequest(rpHints(request));
    const options = await buildAuthenticationOptions({ rp, allowCredentialIds });

    // Read or create a session to persist the challenge.
    const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    let sid: string | null = null;
    let data: SessionData | null = null;
    if (raw) {
      const verified = verifySidFromEnv(raw);
      if (verified) {
        const record = await readSession(verified);
        if (record) {
          sid = verified;
          data = record.data;
        }
      }
    }
    if (!sid || !data) {
      sid = generateSid();
      data = {};
    }
    data.webauthnChallenge = options.challenge;
    await writeSession(sid, data);

    const response = NextResponse.json(options);
    response.cookies.set(SESSION_COOKIE_NAME, signSidFromEnv(sid), sessionCookieAttrs());
    return response;
  } catch (err) {
    logger.error(
      {
        email: bodyEmail ? bodyEmail.replace(/^[^@]+/, '***') : '(none)',
        err: (err as Error)?.message,
      },
      'WebAuthn login options error',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}
