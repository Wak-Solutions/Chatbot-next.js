/**
 * requireAuth — HTTP route guard.
 *
 * Reads the connect.sid cookie + path from a NextRequest, delegates the
 * full session-resolution chain (sid verify, session read, SR-013 60s
 * is_active recheck, trial gate) to @/lib/auth/getSession.resolveSession,
 * and maps the discriminated result to the legacy HTTP responses:
 *
 *   unauthorized        → 401 { message: 'Unauthorized' }
 *   deactivated         → 401 { message: 'Account deactivated' }
 *   service-unavailable → 503 { message: 'Unable to verify account status.' }
 *   trial-expired       → 402 { message, trialExpired: true, trialDays, expiresAt }
 *   authorized          → AuthContext
 *
 * The companion (auth)/ layout calls the same `resolveSession` helper
 * but redirects to /login on a non-authorized result instead of returning
 * NextResponse. Keeping the gate logic in one place avoids the
 * lockout-evasion window the inline duplicate had previously.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from './session';
import { resolveSession, type AuthContext } from './getSession';

export type { AuthContext };

export async function requireAuth(request: NextRequest): Promise<AuthContext | NextResponse> {
  const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const path = new URL(request.url).pathname;
  const result = await resolveSession({ cookieValue, path });

  switch (result.kind) {
    case 'unauthorized':
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    case 'deactivated':
      return NextResponse.json({ message: 'Account deactivated' }, { status: 401 });
    case 'service-unavailable':
      return NextResponse.json(
        { message: 'Unable to verify account status.' },
        { status: 503 },
      );
    case 'trial-expired':
      return NextResponse.json(
        {
          message: 'Your free trial has expired. Please contact support to continue.',
          trialExpired: true,
          trialDays: result.trialDays,
          expiresAt: result.expiresAt,
        },
        { status: 402 },
      );
    case 'authorized':
      return result.auth;
  }
}
