/**
 * GET /api/me/trial — returns the calling tenant's TrialStatus.
 *
 *   401: unauthenticated or invalid companyId
 *   500: query failed
 *   200: TrialStatus
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getCompanyTrialStatus } from '@/lib/auth/trial';
import { createLogger } from '@/lib/logger';

const logger = createLogger('me-trial');

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  const cid = Number(session.user.companyId);
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
