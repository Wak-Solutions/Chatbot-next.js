/**
 * POST /api/register/whatsapp/verify — port of
 * server/routes/register.routes.ts:234-290.
 *
 * Authenticated as admin. Pings the Meta Graph API with the supplied
 * credentials to confirm:
 *   1. The phoneNumberId + accessToken combo is valid.
 *   2. The phoneNumberId belongs to the supplied wabaId.
 *
 * Returns { verified: boolean, displayName?, error?, wabaError? }. The
 * envelope shape matches the original verbatim — the dashboard
 * surfaces `wabaError` to the user separately from `error`.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';

const logger = createLogger('register');

export const dynamic = 'force-dynamic';

export const POST = withAdmin(async (request) => {
  let body: { phoneNumberId?: string; wabaId?: string; accessToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { verified: false, error: 'Missing credentials' },
      { status: 400 },
    );
  }
  const { phoneNumberId, wabaId, accessToken } = body;
  if (!phoneNumberId || !accessToken || !wabaId) {
    return NextResponse.json(
      { verified: false, error: 'Missing credentials' },
      { status: 400 },
    );
  }

  try {
    const metaHeaders = { Authorization: `Bearer ${accessToken}` };

    const phoneResp = await fetch(
      `https://graph.facebook.com/v19.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
      { headers: metaHeaders, signal: AbortSignal.timeout(10_000) },
    );
    const phoneData = (await phoneResp.json()) as {
      error?: { message: string };
      verified_name?: string;
      display_phone_number?: string;
    };
    if (phoneData.error) {
      logger.warn(
        { err: phoneData.error.message },
        'WhatsApp phone number ID verification failed',
      );
      return NextResponse.json({ verified: false, error: phoneData.error.message });
    }
    const displayName = phoneData.verified_name || phoneData.display_phone_number || 'Verified';

    const wabaResp = await fetch(
      `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?fields=id`,
      { headers: metaHeaders, signal: AbortSignal.timeout(10_000) },
    );
    const wabaData = (await wabaResp.json()) as {
      error?: { message: string };
      data?: { id: string | number }[];
    };
    if (wabaData.error) {
      logger.warn(
        { wabaId, err: wabaData.error.message },
        'WhatsApp WABA ID verification failed',
      );
      return NextResponse.json({
        verified: false,
        wabaError: `Invalid WABA ID: ${wabaData.error.message}`,
      });
    }
    const ownedIds: string[] = (wabaData.data ?? []).map((p) => String(p.id));
    if (!ownedIds.includes(String(phoneNumberId))) {
      logger.warn(
        { phoneNumberId, wabaId },
        'Phone number ID not found under WABA',
      );
      return NextResponse.json({
        verified: false,
        wabaError: `Phone Number ID ${phoneNumberId} does not belong to WABA ${wabaId}. Check both values in your Meta Business dashboard.`,
      });
    }

    logger.info({ phoneNumberId, wabaId }, 'WhatsApp credentials verified');
    return NextResponse.json({ verified: true, displayName });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, 'WhatsApp verification error');
    return NextResponse.json({ verified: false, error: 'Could not reach Meta API' });
  }
});
