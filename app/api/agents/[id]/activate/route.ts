/**
 * PATCH /api/agents/[id]/activate — port of server/agents.ts:265-278.
 *
 * DIVERGENCE: plan says POST; original is PATCH. Ported as PATCH for
 * dashboard wire-compat. Flagged.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('agents');

export const dynamic = 'force-dynamic';

export const PATCH = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (_request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const result = await getPool().query(
        `UPDATE agents SET is_active=true WHERE id=$1 AND company_id=$2 RETURNING id`,
        [id, auth.companyId],
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ message: 'Agent not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error({ agentId: id, err: (err as Error)?.message }, 'activateAgent failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
