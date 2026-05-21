/**
 * POST /api/register/complete — port of server/routes/register.routes.ts:415-451.
 *
 * Authenticated as admin. Verifies the company has set both app_url and
 * brand_name (returns 400 with a Settings → Branding hint if not), then
 * flips onboarding_complete = true and is_active = true.
 *
 * Returns the full auth shape so the frontend can populate its cache
 * without a second /api/me round-trip — matches the original
 * register.routes.ts:439-446.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('register');

export const dynamic = 'force-dynamic';

export const POST = withAdmin(async (_request, auth) => {
  const companyId = auth.companyId;

  try {
    const brandingCheck = await getPool().query<{ app_url: string | null; brand_name: string | null }>(
      'SELECT app_url, brand_name FROM companies WHERE id = $1',
      [companyId],
    );
    const row = brandingCheck.rows[0];
    if (!row?.app_url || !row?.brand_name) {
      return NextResponse.json(
        {
          error: 'Please set your App URL and Brand Name in Settings → Branding to complete onboarding.',
        },
        { status: 400 },
      );
    }

    await getPool().query(
      `UPDATE companies
       SET onboarding_complete = true, onboarding_step = 6, is_active = true
       WHERE id = $1`,
      [companyId],
    );
    logger.info({ companyId }, 'Onboarding complete');

    // Auth.js v5 doesn't cache termsAcceptedAt on the session — fetch from DB.
    let termsAcceptedAt: string | null = null;
    try {
      const r = await getPool().query<{ terms_accepted_at: Date | null }>(
        'SELECT terms_accepted_at FROM agents WHERE id = $1',
        [auth.agentId],
      );
      const raw = r.rows[0]?.terms_accepted_at;
      termsAcceptedAt = raw ? new Date(raw).toISOString() : null;
    } catch {
      // best-effort — frontend can re-fetch
    }

    return NextResponse.json({
      success: true,
      authenticated: true,
      role: auth.role,
      agentId: auth.agentId,
      agentName: auth.agentName,
      termsAcceptedAt,
    });
  } catch (err) {
    logger.error(
      { companyId, err: (err as Error)?.message },
      'Complete onboarding failed',
    );
    return NextResponse.json({ error: 'Failed to complete onboarding' }, { status: 500 });
  }
});
