/**
 * POST /api/auth/webauthn/register/verify — port of
 * server/routes/auth.routes.ts:249-282.
 *
 * Authenticated. Pairs with the options endpoint via
 * session.webauthnChallenge. On success stores the credential in
 * webauthn_credentials (ON CONFLICT UPDATE so re-registration replaces
 * the prior public key). Clears the challenge after use.
 *
 * On RP-ID / origin mismatch the response carries the WEBAUTHN_RP_MISMATCH
 * code so PR 10's login page can show its re-registration CTA.
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
  verifyRegistration,
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
    const body = await request.json();

    const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!raw) return NextResponse.json({ message: 'No pending registration challenge' }, { status: 400 });
    const sid = verifySidFromEnv(raw);
    if (!sid) return NextResponse.json({ message: 'No pending registration challenge' }, { status: 400 });
    const record = await readSession(sid);
    const challenge = record?.data.webauthnChallenge;
    if (!challenge) return NextResponse.json({ message: 'No pending registration challenge' }, { status: 400 });

    // Clear the challenge BEFORE verification so a failed attempt can never
    // be replayed. If the session write fails (DB blip), proceed with
    // verification anyway and log the write failure — losing a legitimate
    // registration to a transient DB error is worse UX than the residual
    // single-replay window. The challenge is single-use whether we clear it
    // here or not; clearing makes that guarantee explicit on the failure path.
    record.data.webauthnChallenge = undefined;
    try {
      await writeSession(sid, record.data);
    } catch (writeErr) {
      logger.error(
        { agentId: auth.agentId, err: (writeErr as Error)?.message },
        'WebAuthn challenge clear failed — proceeding with verification',
      );
    }

    const rp = deriveRpFromRequest(rpHints(request));
    const result = await verifyRegistration({ rp, expectedChallenge: challenge, response: body });

    if (!result.ok) {
      logger.warn(
        { agentId: auth.agentId, code: result.code },
        'WebAuthn registration verification failed',
      );
      return NextResponse.json(
        { message: 'Biometric registration failed', code: result.code },
        { status: 400 },
      );
    }

    const credential = result.info.registrationInfo?.credential;
    if (!credential) {
      return NextResponse.json({ message: 'Verification failed' }, { status: 400 });
    }
    const pubKeyHex = Buffer.from(credential.publicKey).toString('hex');
    await getPool().query(
      `INSERT INTO webauthn_credentials (agent_id, credential_id, public_key, counter)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (credential_id) DO UPDATE SET public_key=$3, counter=$4`,
      [auth.agentId, credential.id, pubKeyHex, credential.counter],
    );

    logger.info({ agentId: auth.agentId }, 'WebAuthn credential registered');
    return NextResponse.json({ verified: true });
  } catch (err) {
    logger.error(
      { agentId: auth.agentId, err: (err as Error)?.message },
      'WebAuthn register verify error',
    );
    return NextResponse.json({ message: 'Biometric registration failed' }, { status: 400 });
  }
});
