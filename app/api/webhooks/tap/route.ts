/**
 * POST /api/webhooks/tap — Tap payment notifications.
 *
 * Public endpoint, but every request is HMAC-verified by the provider adapter
 * (hashstring header) before we trust a single field. On a verified CAPTURED
 * we activate/renew the subscription and extend access; on DECLINED we record
 * the failure. Idempotent on charge id (handled in applyCapturedCharge).
 *
 * Always returns 200 on a well-formed-but-verified event — Tap retries on
 * non-2xx, and we don't want retries for events we've already processed.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getActiveProvider } from '@/lib/payments/provider';
import { applyCapturedCharge, recordFailedCharge } from '@/lib/payments/subscription';

const logger = createLogger('tap-webhook');

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Raw body is required for signature verification — read as text.
  const raw = await request.text();
  const provider = await getActiveProvider();

  const event = provider.verifyAndParseWebhook(raw, request.headers);
  if (!event) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  try {
    if (event.type === 'captured') {
      await applyCapturedCharge(provider.id, event);
    } else if (event.type === 'declined' && event.companyId !== null) {
      await recordFailedCharge(event.companyId);
    }
  } catch (err) {
    // Log and still 200: a duplicate/late event shouldn't trigger endless
    // Tap retries. Genuine outages surface via the error log + missing renewal.
    logger.error(
      { chargeId: event.chargeId, type: event.type, err: (err as Error)?.message },
      'webhook processing failed',
    );
  }

  return NextResponse.json({ received: true });
}
