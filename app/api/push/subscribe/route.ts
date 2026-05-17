/**
 * POST /api/push/subscribe — port of server/routes/push.routes.ts:19-33.
 *
 * Authenticated. Upserts a Web Push subscription into push_subscriptions,
 * scoped by the UNIQUE (endpoint) constraint named
 * push_subscriptions_endpoint_key from the PR 2 schema. Re-subscribing
 * from the same endpoint rebinds agent_id / company_id and bumps
 * updated_at.
 *
 *   400: { message: 'Invalid subscription object' }   missing endpoint
 *   500: { message: 'Internal error' }
 *   200: { success: true }
 *
 * CSRF: wrapped in withCsrf for consistency, but the route is on the
 * lib/auth/csrf PUBLIC_AUTH_PREFIXES allowlist so the check is a no-op.
 * Auth is enforced by withAuth.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { registerSubscription, type PushSubscription } from '@/lib/notifications/push';
import { createLogger } from '@/lib/logger';

const logger = createLogger('push');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth(async (request, auth) => {
    try {
      const subscription = (await request.json()) as PushSubscription;
      if (!subscription?.endpoint) {
        return NextResponse.json({ message: 'Invalid subscription object' }, { status: 400 });
      }
      await registerSubscription(auth.agentId, auth.companyId, subscription);
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'Subscribe failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
