/**
 * GET /api/billing — current plan, renewal schedule, and live usage for the
 * admin's company. Drives the in-app billing UI. Admin-only.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { PLANS, PLAN_ORDER, isPlanId } from '@/lib/payments/plans';
import { getSubscription, periodStart } from '@/lib/payments/subscription';
import { getUsage } from '@/lib/payments/usage';

const logger = createLogger('billing');

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (_request, auth) => {
  try {
    const sub = await getSubscription(auth.companyId);
    const start = await periodStart(auth.companyId);
    const usage = await getUsage(auth.companyId, start);
    const planId = sub && isPlanId(sub.plan) ? sub.plan : null;

    return NextResponse.json({
      plans: PLAN_ORDER.map((id) => PLANS[id]),
      subscription: sub
        ? {
            plan: sub.plan,
            status: sub.status,
            currentPeriodEnd: sub.current_period_end,
            nextChargeAt: sub.next_charge_at,
          }
        : null,
      usage,
      limits: planId ? { chats: PLANS[planId].chats, messages: PLANS[planId].messages } : null,
    });
  } catch (err) {
    logger.error({ companyId: auth.companyId, err: (err as Error)?.message }, 'GET billing failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
