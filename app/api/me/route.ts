/**
 * GET /api/me — port of server/routes/auth.routes.ts:181-213.
 *
 * Returns 200 in both authenticated and unauthenticated cases — the
 * frontend calls this proactively to discover auth state, so 401 would
 * spam the browser console with errors.
 *
 *   Unauthenticated:  { authenticated: false }
 *   Authenticated:    { authenticated, role, agentId, agentName, termsAcceptedAt }
 *
 * The handler reads the session directly (not via requireAuth) because
 * requireAuth returns 401 for unauthenticated requests, which is wrong
 * for this endpoint.
 *
 * Side effect: on a session that pre-dates termsAcceptedAt caching, the
 * value is fetched from agents.terms_accepted_at and written back into
 * the session — matches auth.routes.ts:194 ("(req.session as any).
 * termsAcceptedAt = termsAcceptedAt") so subsequent /me calls skip the
 * DB hit.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, readSession, writeSession } from '@/lib/auth/session';
import { verifySidFromEnv } from '@/lib/auth/cookies';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return NextResponse.json({ authenticated: false });
  const sid = verifySidFromEnv(raw);
  if (!sid) return NextResponse.json({ authenticated: false });
  const record = await readSession(sid);
  if (!record?.data.authenticated) return NextResponse.json({ authenticated: false });
  const session = record.data;

  let termsAcceptedAt: string | null | undefined = session.termsAcceptedAt;
  if (termsAcceptedAt === undefined && session.agentId) {
    try {
      const r = await getPool().query<{ terms_accepted_at: Date | null }>(
        'SELECT terms_accepted_at FROM agents WHERE id = $1',
        [session.agentId],
      );
      const rawDate = r.rows[0]?.terms_accepted_at;
      termsAcceptedAt = rawDate ? new Date(rawDate).toISOString() : null;
      session.termsAcceptedAt = termsAcceptedAt;
      await writeSession(sid, session);
    } catch (err) {
      logger.warn(
        { agentId: session.agentId, err: (err as Error)?.message },
        'Could not fetch terms_accepted_at',
      );
      termsAcceptedAt = null;
    }
  }

  return NextResponse.json({
    authenticated: true,
    role: session.role || 'admin',
    agentId: session.agentId || null,
    agentName: session.agentName || 'Admin',
    termsAcceptedAt: termsAcceptedAt ?? null,
  });
}
