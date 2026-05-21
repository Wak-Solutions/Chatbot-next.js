/**
 * POST /api/agents/accept-terms — records T&C acceptance on the agent
 * row. Auth.js v5 sessions don't carry mutable per-field state on the
 * server, so the session-writeback the legacy handler did is dropped;
 * the next /api/me call reads termsAcceptedAt from the agents row.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('agents');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth(async (_request, auth) => {
    try {
      const agentId = auth.agentId;
      if (!agentId) {
        return NextResponse.json({ message: 'No agent ID in session' }, { status: 400 });
      }
      const result = await getPool().query<{ terms_accepted_at: Date | null }>(
        `UPDATE agents SET terms_accepted_at = NOW()
         WHERE id = $1 AND company_id = $2 RETURNING terms_accepted_at`,
        [agentId, auth.companyId],
      );
      const acceptedAt = result.rows[0]?.terms_accepted_at
        ? new Date(result.rows[0].terms_accepted_at).toISOString()
        : new Date().toISOString();
      return NextResponse.json({ success: true, termsAcceptedAt: acceptedAt });
    } catch (err) {
      logger.error({ agentId: auth.agentId, err: (err as Error)?.message }, 'acceptTerms failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
