/**
 * GET /api/me/trial — port of server/routes.ts:135-146.
 *
 * NOTE on auth shape: the original Express handler does NOT use the
 * requireAuth middleware. It performs only an inline check
 * (`!req.session.authenticated || !Number.isInteger(cid) || cid <= 0`)
 * and skips the SR-013 60-second is_active recheck that requireAuth does.
 * Porting via withAuth() here would introduce that recheck as a new
 * observable behavior, so we replicate the original inline check verbatim.
 *
 *   401: not authenticated or invalid companyId in session
 *   500: trial-status query failed
 *   200: TrialStatus (see @/lib/auth/trial)
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME, readSession } from '@/lib/auth/session';
import { verifySidFromEnv } from '@/lib/auth/cookies';
import { getCompanyTrialStatus } from '@/lib/auth/trial';
import { createLogger } from '@/lib/logger';

const logger = createLogger('me-trial');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const sid = verifySidFromEnv(raw);
  if (!sid) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  const record = await readSession(sid);
  const session = record?.data;
  if (!session?.authenticated) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  const cid = Number(session.companyId);
  if (!Number.isInteger(cid) || cid <= 0) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getCompanyTrialStatus(cid));
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, '/api/me/trial failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}
