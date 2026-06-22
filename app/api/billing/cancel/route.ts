/**
 * POST /api/billing/cancel — stop auto-renewal.
 *
 * Marks the subscription canceled and clears next_charge_at, so the cron
 * stops charging. Access (companies.subscription_ends_at) is left untouched,
 * so the customer keeps what they paid for until the period ends. Admin-only.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { cancelSubscription } from '@/lib/payments/subscription';

const logger = createLogger('billing');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAdmin(async (_request, auth) => {
    try {
      await cancelSubscription(auth.companyId);
      logger.info({ companyId: auth.companyId }, 'subscription canceled');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, err: (err as Error)?.message },
        'cancel failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
