/**
 * POST /api/agents/accept-terms — port of server/agents.ts:73-93.
 *
 * Any authenticated agent records T&C acceptance on their own row.
 * Persists termsAcceptedAt into the session JSON so /api/me doesn't
 * fall back to the DB on the next call.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { SESSION_COOKIE_NAME, readSession, writeSession } from '@/lib/auth/session';
import { verifySidFromEnv } from '@/lib/auth/cookies';

const logger = createLogger('agents');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth(async (request, auth) => {
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

      // Persist into the session JSON so /api/me skips the DB fallback.
      const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
      if (raw) {
        const sid = verifySidFromEnv(raw);
        if (sid) {
          const record = await readSession(sid);
          if (record) {
            record.data.termsAcceptedAt = acceptedAt;
            await writeSession(sid, record.data);
          }
        }
      }
      return NextResponse.json({ success: true, termsAcceptedAt: acceptedAt });
    } catch (err) {
      logger.error({ agentId: auth.agentId, err: (err as Error)?.message }, 'acceptTerms failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
