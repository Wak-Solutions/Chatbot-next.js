/**
 * GET /api/me — returns auth shape; 200 in both states (frontend probes
 * proactively).
 *
 * Auth.js v5: reads session via `auth()`. `termsAcceptedAt` is no longer
 * cached on the session — fetched from the agents row each call.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth');

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ authenticated: false });

  const agentId = Number(session.user.id);
  let termsAcceptedAt: string | null = null;
  try {
    const r = await getPool().query<{ terms_accepted_at: Date | null }>(
      'SELECT terms_accepted_at FROM agents WHERE id = $1',
      [agentId],
    );
    const raw = r.rows[0]?.terms_accepted_at;
    termsAcceptedAt = raw ? new Date(raw).toISOString() : null;
  } catch (err) {
    logger.warn(
      { agentId, err: (err as Error)?.message },
      'Could not fetch terms_accepted_at',
    );
  }

  return NextResponse.json({
    authenticated: true,
    role: session.user.role || 'admin',
    agentId,
    agentName: session.user.name || 'Admin',
    companyId: session.user.companyId ?? null,
    termsAcceptedAt,
  });
}
