/**
 * PATCH /api/agents/[id]/deactivate — port of server/agents.ts:231-262.
 *
 * DIVERGENCE: plan says POST; original is PATCH. Ported as PATCH for
 * dashboard wire-compat. Flagged.
 *
 * Protections (hard req #3):
 *   - Self-deactivation protection.
 *   - Last-admin protection (atomic check inside the same transaction).
 *   - Session purge immediately after deactivation.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('agents');

export const dynamic = 'force-dynamic';

export const PATCH = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (_request, auth, ctx) => {
    const { id: idStr } = await ctx.params;
    const id = parseInt(idStr, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ message: 'Invalid id' }, { status: 400 });
    }
    if (auth.agentId === id) {
      return NextResponse.json(
        { message: 'You cannot deactivate your own account.' },
        { status: 400 },
      );
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const agentRes = await client.query<{ role: string }>(
        'SELECT role FROM agents WHERE id=$1 AND company_id=$2',
        [id, auth.companyId],
      );
      if (agentRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ message: 'Agent not found' }, { status: 404 });
      }
      if (agentRes.rows[0].role === 'admin') {
        const adminCount = await client.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM agents
           WHERE role='admin' AND is_active=true AND id!=$1 AND company_id=$2`,
          [id, auth.companyId],
        );
        if (adminCount.rows[0].n === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { message: 'Cannot deactivate the last active admin.' },
            { status: 400 },
          );
        }
      }
      await client.query(
        'UPDATE agents SET is_active=false WHERE id=$1 AND company_id=$2',
        [id, auth.companyId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ agentId: id, err: (err as Error)?.message }, 'deactivateAgent failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    } finally {
      client.release();
    }
    await getPool()
      .query(`DELETE FROM session WHERE sess->>'agentId' = $1::text`, [id])
      .catch((err: Error) =>
        logger.error({ agentId: id, err: err.message }, 'Session purge failed (non-fatal)'),
      );
    logger.info({ agentId: id }, 'Agent deactivated');
    return NextResponse.json({ success: true });
  }),
);
