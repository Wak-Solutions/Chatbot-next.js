/**
 * GET /api/agents/presence — who's available right now, for the whole team.
 *
 * Unlike /api/agents (admin-only management list), this is open to any
 * authenticated agent so everyone can see who else is online. Returns active
 * agents with their Available/Away flag, available first.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('presence');

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request, auth) => {
  try {
    const r = await getPool().query<{ id: number; name: string; is_available: boolean | null }>(
      `SELECT id, name, is_available
         FROM agents
        WHERE company_id = $1 AND is_active = true
        ORDER BY is_available DESC NULLS LAST, name ASC`,
      [auth.companyId],
    );
    return NextResponse.json(
      r.rows.map((a) => ({ id: a.id, name: a.name, available: Boolean(a.is_available) })),
    );
  } catch (err) {
    logger.error({ companyId: auth.companyId, err: (err as Error)?.message }, 'getPresence failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
