/**
 * /api/agents/[id] — PUT (update fields) + DELETE (soft-delete).
 *
 * PUT — port of server/agents.ts:208-228. Updates name/email/role.
 *
 * DELETE — soft-delete with the three protections from hard req #3:
 *   - Self-deletion protection: actor cannot delete their own row.
 *   - Last-admin protection: cannot delete the last active admin.
 *   - Session purge: DELETE FROM session WHERE sess->>'agentId' = $1
 *     so the user is logged out within seconds, not the SR-013 ~60s.
 *
 * Soft-delete model: the legacy server doesn't actually DELETE from
 * agents anywhere (FK references in escalations/meetings/etc would
 * break). We treat DELETE as a deactivate that also purges sessions —
 * matches the legacy /deactivate semantics.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('agents');

const updateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['agent', 'admin']),
});

export const dynamic = 'force-dynamic';

export const PUT = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const { name, email, role } = updateSchema.parse(await request.json());
      const result = await getPool().query(
        `UPDATE agents SET name=$1, email=$2, role=$3 WHERE id=$4 AND company_id=$5
         RETURNING id, name, email, role, is_active`,
        [name, email, role, id, auth.companyId],
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ message: 'Agent not found' }, { status: 404 });
      }
      return NextResponse.json(result.rows[0]);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
      }
      logger.error(
        { companyId: auth.companyId, targetAgentId: id, actorAgentId: auth.agentId, err: (err as Error)?.message },
        'updateAgent failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);

export const DELETE = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (_request, auth, ctx) => {
    const { id: idStr } = await ctx.params;
    const id = parseInt(idStr, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ message: 'Invalid id' }, { status: 400 });
    }
    if (auth.agentId === id) {
      return NextResponse.json(
        { message: 'You cannot delete your own account.' },
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
            { message: 'Cannot delete the last active admin.' },
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
      logger.error({ agentId: id, err: (err as Error)?.message }, 'deleteAgent failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    } finally {
      client.release();
    }
    // Purge sessions outside the agents transaction — session and agents
    // are in the same DB, but the session purge must succeed independently
    // (best-effort) so a session-table hiccup doesn't undo the deactivation.
    await getPool()
      .query(`DELETE FROM session WHERE sess->>'agentId' = $1::text`, [id])
      .catch((err: Error) =>
        logger.error({ agentId: id, err: err.message }, 'Session purge failed (non-fatal)'),
      );
    logger.info({ agentId: id }, 'Agent deleted (deactivated + sessions purged)');
    return NextResponse.json({ success: true });
  }),
);
