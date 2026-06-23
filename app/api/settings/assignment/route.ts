/**
 * GET/PUT /api/settings/assignment — the company's chat-assignment mode.
 *
 * false (default) = manual: handed-off chats wait in the Unclaimed inbox for
 * an agent to claim. true = automatic: each handoff is assigned to the
 * least-busy available agent. Admin-only; PUT is CSRF-guarded.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('settings');

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (_request, auth) => {
  try {
    const r = await getPool().query<{ auto_assign: boolean | null }>(
      'SELECT auto_assign FROM companies WHERE id = $1',
      [auth.companyId],
    );
    return NextResponse.json({ autoAssign: r.rows[0]?.auto_assign ?? false });
  } catch (err) {
    logger.error({ companyId: auth.companyId, err: (err as Error)?.message }, 'getAssignment failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});

export const PUT = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const body = ((await request.json()) ?? {}) as { autoAssign?: unknown };
      if (typeof body.autoAssign !== 'boolean') {
        return NextResponse.json({ message: 'Body must include { autoAssign: boolean }' }, { status: 400 });
      }
      await getPool().query('UPDATE companies SET auto_assign = $1 WHERE id = $2', [
        body.autoAssign,
        auth.companyId,
      ]);
      logger.info({ companyId: auth.companyId, autoAssign: body.autoAssign }, 'assignment mode updated');
      return NextResponse.json({ autoAssign: body.autoAssign });
    } catch (err) {
      logger.error({ companyId: auth.companyId, err: (err as Error)?.message }, 'setAssignment failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
