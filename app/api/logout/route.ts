/**
 * POST /api/logout — port of server/routes/auth.routes.ts:162-178.
 *
 * Destroys whatever session row the cookie points at (if any), then clears
 * the connect.sid cookie on the response. Always 200 with `{ success: true }`.
 * Errors during destroy are logged and swallowed — matches the original's
 * fire-and-forget logout semantic.
 */

import { NextResponse, type NextRequest } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  destroySession,
  clearedSessionCookieAttrs,
} from '@/lib/auth/session';
import { verifySidFromEnv } from '@/lib/auth/cookies';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth');

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  let agentId: number | null | undefined;
  if (raw) {
    const sid = verifySidFromEnv(raw);
    if (sid) {
      try {
        await destroySession(sid);
      } catch (err) {
        logger.warn(
          { err: (err as Error)?.message },
          'Session destroy error (non-fatal)',
        );
      }
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE_NAME, '', clearedSessionCookieAttrs());
  logger.info({ agentId }, 'Logout complete');
  return response;
}
