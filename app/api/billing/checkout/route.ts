/**
 * POST /api/billing/checkout — start a subscription.
 *
 * Body: { plan: 'starter' | 'growth' | 'pro' }. Creates the first (card-
 * storing) charge via the active payment provider and returns the hosted
 * payment-page URL for the browser to redirect to. Admin-only, CSRF-guarded.
 * No card data ever touches our servers.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { getPlan, isPlanId } from '@/lib/payments/plans';
import { getActiveProvider } from '@/lib/payments/provider';

const logger = createLogger('billing');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const body = ((await request.json()) ?? {}) as { plan?: string };
      if (!isPlanId(body.plan)) {
        return NextResponse.json({ message: 'Unknown plan' }, { status: 400 });
      }

      const base = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '');
      if (!base) {
        logger.error('DASHBOARD_URL not set — cannot build redirect/webhook URLs');
        return NextResponse.json({ message: 'Billing is not configured' }, { status: 500 });
      }

      const r = await getPool().query<{
        id: number;
        name: string | null;
        email: string | null;
        phone: string | null;
      }>('SELECT id, name, email, phone FROM companies WHERE id = $1', [auth.companyId]);
      const company = r.rows[0];
      if (!company) {
        return NextResponse.json({ message: 'Company not found' }, { status: 404 });
      }

      const provider = await getActiveProvider();
      const { url } = await provider.createCheckout({
        company,
        plan: getPlan(body.plan),
        redirectUrl: `${base}/settings?billing=done`,
        webhookUrl: `${base}/api/webhooks/${provider.id}`,
      });

      logger.info({ companyId: auth.companyId, plan: body.plan }, 'checkout created');
      return NextResponse.json({ url });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, err: (err as Error)?.message },
        'checkout failed',
      );
      return NextResponse.json({ message: 'Could not start checkout' }, { status: 502 });
    }
  }),
);
