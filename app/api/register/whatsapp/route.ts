/**
 * PUT /api/register/whatsapp — port of server/routes/register.routes.ts:210-231.
 *
 * DIVERGENCE from PR plan: plan lists this as POST, but the existing
 * Express handler is PUT. Ported as PUT to keep the dashboard client
 * compatible. Flagging.
 *
 * Authenticated as admin. Stores WhatsApp credentials on the companies
 * row and bumps onboarding_step to at least 4.
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
    phoneNumberId?: string;
    wabaId?: string;
    accessToken?: string;
    appSecret?: string;
  };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { phoneNumberId, wabaId, accessToken, appSecret } = body;

  try {
    await getPool().query(
      `UPDATE companies
       SET whatsapp_phone_number_id = $1,
           whatsapp_waba_id = $2,
           whatsapp_token = $3,
           whatsapp_app_secret = $4,
           onboarding_step = GREATEST(onboarding_step, 4)
       WHERE id = $5`,
      [phoneNumberId, wabaId, accessToken, appSecret || null, companyId],
    );
    logger.info({ companyId }, 'WhatsApp credentials saved');
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ companyId, err: (err as Error)?.message }, 'WhatsApp save failed');
    return NextResponse.json({ error: 'Failed to save WhatsApp credentials' }, { status: 500 });
  }
});
