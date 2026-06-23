/**
 * GET/POST /api/me/availability — the logged-in agent's Available/Away status.
 *
 * Manual presence (per the chosen model): the agent flips their own switch;
 * we store it on agents.is_available. Used to show who's present and, later,
 * to scope auto-assignment to available agents.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('availability');

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request, auth) => {
  try {
    const r = await getPool().query<{ is_available: boolean | null }>(
      'SELECT is_available FROM agents WHERE id = $1',
      [auth.agentId],
    );
    return NextResponse.json({ available: r.rows[0]?.is_available ?? false });
  } catch (err) {
    logger.error({ agentId: auth.agentId, err: (err as Error)?.message }, 'get availability failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});

export const POST = withCsrf(
  withAuth(async (request, auth) => {
    try {
      const body = ((await request.json()) ?? {}) as { available?: unknown };
      if (typeof body.available !== 'boolean') {
        return NextResponse.json({ message: 'Body must include { available: boolean }' }, { status: 400 });
      }
      await getPool().query('UPDATE agents SET is_available = $1 WHERE id = $2', [
        body.available,
        auth.agentId,
      ]);
      logger.info({ agentId: auth.agentId, available: body.available }, 'availability updated');
      return NextResponse.json({ available: body.available });
    } catch (err) {
      logger.error({ agentId: auth.agentId, err: (err as Error)?.message }, 'set availability failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
