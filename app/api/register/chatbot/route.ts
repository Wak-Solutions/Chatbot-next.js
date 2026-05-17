/**
 * PUT /api/register/chatbot — port of server/routes/register.routes.ts:297-310.
 *
 * DIVERGENCE from PR plan: plan lists this as POST, but the existing
 * Express handler is PUT. Ported as PUT to keep the dashboard client
 * compatible. Flagging.
 *
 * NOTE: this endpoint is intentionally a no-op (chatbot configuration
 * moved out of signup; see the comment block at register.routes.ts:292-296).
 * It only advances onboarding_step to at least 5 so in-flight frontend
 * calls don't 404 during the transition. Kept here for parity.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('register');

export const dynamic = 'force-dynamic';

export const PUT = withAdmin(async (_request, auth) => {
  const companyId = auth.companyId;
  try {
    await getPool().query(
      'UPDATE companies SET onboarding_step = GREATEST(onboarding_step, 5) WHERE id = $1',
      [companyId],
    );
    logger.info({ companyId }, 'Register chatbot step skipped (no-op)');
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error(
      { companyId, err: (err as Error)?.message },
      'Register chatbot no-op failed',
    );
    return NextResponse.json({ error: 'Failed to advance onboarding step' }, { status: 500 });
  }
});
