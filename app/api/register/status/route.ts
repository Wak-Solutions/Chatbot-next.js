/**
 * GET /api/register/status — port of server/routes/register.routes.ts:454-475.
 *
 * Authenticated. Returns the current company name + onboarding progress so
 * the dashboard can resume an interrupted registration at the right step.
 *
 *   { companyName, onboardingStep, onboardingComplete }
 *
 *   404 if the company row is gone (shouldn't happen for an authenticated
 *       session, but matches the original's defensive 404).
 *   500 on query failure.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('register');

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request, auth) => {
  const companyId = auth.companyId;
  try {
    const result = await getPool().query<{
      name: string | null;
      onboarding_step: number | null;
      onboarding_complete: boolean | null;
    }>(
      'SELECT name, onboarding_step, onboarding_complete FROM companies WHERE id = $1',
      [companyId],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    }
    const row = result.rows[0];
    return NextResponse.json({
      companyName: row.name,
      onboardingStep: row.onboarding_step || 1,
      onboardingComplete: row.onboarding_complete || false,
    });
  } catch (err) {
    logger.error(
      { companyId, err: (err as Error)?.message },
      'Status check failed',
    );
    return NextResponse.json({ error: 'Failed to check status' }, { status: 500 });
  }
});
