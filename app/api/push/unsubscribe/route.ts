/**
 * POST /api/push/unsubscribe — port of server/routes/push.routes.ts:35-47.
 *
 * Authenticated. Deletes the matching (endpoint, agent, company) tuple
 * from push_subscriptions. No-op if endpoint is missing in the body —
 * matches the original.
 *
 *   200: { success: true }
 *   500: { message: 'Internal error' }
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { removeSubscriptionForAgent } from '@/lib/notifications/push';
import { createLogger } from '@/lib/logger';

const logger = createLogger('push');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth(async (request, auth) => {
    try {
      const body = (await request.json()) as { endpoint?: string };
      const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : '';
      if (endpoint) {
        await removeSubscriptionForAgent(endpoint, auth.agentId, auth.companyId);
      }
      logger.info({ agentId: auth.agentId }, 'Push subscription removed');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'Unsubscribe failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
