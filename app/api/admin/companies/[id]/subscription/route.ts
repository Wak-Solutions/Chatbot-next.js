/**
 * POST /api/admin/companies/[id]/subscription — platform-owner-only.
 * Extend or set a tenant's access. Same service functions a payment webhook
 * will call later (lib/auth/trial.ts).
 *
 * Body (zod discriminated union on `action`):
 *   { action: 'extend',    days: 1..3650 }       → push expiry out by N days
 *   { action: 'setUntil',  until: ISO | null }   → explicit access-until date
 *   { action: 'unlimited', unlimited: boolean }  → toggle never-expires
 *
 * Returns the company's refreshed TrialStatus.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withCsrf, withPlatformAdmin } from '@/lib/http/handlers';
import {
  extendSubscriptionDays,
  setSubscriptionUntil,
  setUnlimitedAccess,
} from '@/lib/auth/trial';
import { createLogger } from '@/lib/logger';

const logger = createLogger('admin-subscription');

export const dynamic = 'force-dynamic';

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('extend'), days: z.number().int().min(1).max(3650) }),
  z.object({ action: z.literal('setUntil'), until: z.string().datetime().nullable() }),
  z.object({ action: z.literal('unlimited'), unlimited: z.boolean() }),
]);

export const POST = withCsrf(
  withPlatformAdmin<{ params: Promise<{ id: string }> }>(async (request, auth, ctx) => {
    const { id } = await ctx.params;
    const companyId = Number(id);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return NextResponse.json({ message: 'Invalid company id' }, { status: 400 });
    }

    try {
      const body = bodySchema.parse(await request.json());

      let status;
      switch (body.action) {
        case 'extend':
          status = await extendSubscriptionDays(companyId, body.days);
          break;
        case 'setUntil':
          status = await setSubscriptionUntil(companyId, body.until ? new Date(body.until) : null);
          break;
        case 'unlimited':
          status = await setUnlimitedAccess(companyId, body.unlimited);
          break;
      }

      logger.info(
        { actorAgentId: auth.agentId, companyId, action: body.action },
        'subscription updated',
      );
      return NextResponse.json(status);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
      }
      logger.error(
        { actorAgentId: auth.agentId, companyId, err: (err as Error)?.message },
        'subscription update failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
