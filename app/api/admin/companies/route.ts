/**
 * GET /api/admin/companies — platform-owner-only list of every tenant with
 * its effective subscription/trial status. Backs the admin subscriptions
 * screen. Guarded by withPlatformAdmin (company 1 admins only).
 *
 * Effective expiry mirrors lib/auth/trial.ts: unlimited_access never expires;
 * otherwise COALESCE(subscription_ends_at, created_at + trial_days).
 */

import { NextResponse } from 'next/server';
import { withPlatformAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { getTrialDays } from '@/lib/auth/trial';
import { createLogger } from '@/lib/logger';

const logger = createLogger('admin-companies');

export const dynamic = 'force-dynamic';

export const GET = withPlatformAdmin(async () => {
  try {
    const trialDays = await getTrialDays();
    const r = await getPool().query(
      `SELECT c.id::int                                   AS id,
              c.name                                      AS name,
              c.email                                     AS email,
              c.created_at                                AS created_at,
              c.subscription_ends_at                      AS subscription_ends_at,
              c.unlimited_access                          AS unlimited,
              COALESCE(c.subscription_ends_at, c.created_at + ($1 || ' days')::INTERVAL) AS expires_at,
              (NOT c.unlimited_access)
                AND NOW() > COALESCE(c.subscription_ends_at, c.created_at + ($1 || ' days')::INTERVAL) AS expired,
              GREATEST(
                0,
                CEIL(EXTRACT(EPOCH FROM (COALESCE(c.subscription_ends_at, c.created_at + ($1 || ' days')::INTERVAL) - NOW())) / 86400)
              )::int                                      AS days_remaining,
              (SELECT COUNT(*) FROM agents a WHERE a.company_id = c.id)::int AS agent_count
       FROM companies c
       ORDER BY c.id`,
      [String(trialDays)],
    );

    const companies = r.rows.map((row) => {
      const unlimited = Boolean(row.unlimited);
      return {
        id: Number(row.id),
        name: row.name as string | null,
        email: row.email as string | null,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        subscriptionEndsAt: row.subscription_ends_at ? new Date(row.subscription_ends_at).toISOString() : null,
        unlimited,
        expiresAt: unlimited ? null : (row.expires_at ? new Date(row.expires_at).toISOString() : null),
        expired: Boolean(row.expired),
        daysRemaining: unlimited ? null : Number(row.days_remaining ?? 0),
        agentCount: Number(row.agent_count ?? 0),
      };
    });

    return NextResponse.json({ trialDays, companies });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, 'list companies failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
