/**
 * POST /api/auth/webauthn/register/options — port of
 * server/routes/auth.routes.ts:216-246.
 *
 * Authenticated. Excludes the current agent's already-registered
 * credentials so the authenticator won't enroll a duplicate.
 *
 * Persists the issued challenge in session.webauthnChallenge so the
 * paired verify endpoint can match it.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import {
  SESSION_COOKIE_NAME,
  readSession,
  writeSession,
} from '@/lib/auth/session';
import { verifySidFromEnv } from '@/lib/auth/cookies';
import {
  buildRegistrationOptions,
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

export const POST = withAuth(async (request, auth) => {
  try {
    const existing = await getPool().query<{ credential_id: string }>(
      'SELECT credential_id FROM webauthn_credentials WHERE agent_id = $1',
      [auth.agentId],
    );
    const excludeCredentialIds = existing.rows.map((r) => r.credential_id);

    const rp = deriveRpFromRequest(rpHints(request));
    const options = await buildRegistrationOptions({
      rp,
      agentId: auth.agentId,
      agentName: auth.agentName,
      excludeCredentialIds,
    });

    // Persist challenge into the current session row.
    const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (raw) {
      const sid = verifySidFromEnv(raw);
      if (sid) {
        const record = await readSession(sid);
        if (record) {
          record.data.webauthnChallenge = options.challenge;
          await writeSession(sid, record.data);
        }
      }
    }

    logger.info({ agentId: auth.agentId }, 'WebAuthn register options generated');
    return NextResponse.json(options);
  } catch (err) {
    logger.error(
      { agentId: auth.agentId, err: (err as Error)?.message },
      'WebAuthn register options error',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
