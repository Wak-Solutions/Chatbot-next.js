/**
 * PUT /api/register/business — port of server/routes/register.routes.ts:185-207.
 *
 * DIVERGENCE from PR plan: plan lists this as POST, but the existing
 * Express handler is PUT. Ported as PUT to keep the dashboard client
 * (which already sends PUT) compatible. Flagging.
 *
 * Authenticated as admin. Updates company business details and bumps
 * onboarding_step to at least 3.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('register');

export const dynamic = 'force-dynamic';

export const PUT = withAdmin(async (request, auth) => {
  const companyId = auth.companyId;
  let body: {
    businessName?: string;
    industry?: string;
    country?: string;
    website?: string;
    teamSize?: string;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { businessName, industry, country, website, teamSize } = body;

  try {
    await getPool().query(
      `UPDATE companies
       SET name = COALESCE($1, name),
           industry = $2,
           country = $3,
           website = $4,
           team_size = $5,
           onboarding_step = GREATEST(onboarding_step, 3)
       WHERE id = $6`,
      [businessName, industry, country, website, teamSize, companyId],
    );
    logger.info({ companyId }, 'Business details saved');
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ companyId, err: (err as Error)?.message }, 'Business details failed');
    return NextResponse.json({ error: 'Failed to save business details' }, { status: 500 });
  }
});
