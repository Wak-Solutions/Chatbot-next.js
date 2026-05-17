/**
 * GET /api/push/vapid-public-key
 *
 * DIVERGENCE from the original: server/routes/push.routes.ts:15 gates this
 * endpoint behind requireAuth. The PR 7 plan asks for it as public. The
 * VAPID public key is, by definition, public — service-worker scripts
 * fetch it before any user is logged in, and Web Push spec assumes it's
 * retrievable without authentication. Going with the plan. Flagging.
 *
 *   200: { publicKey: string }
 *   The publicKey is "" if VAPID isn't configured — matches the
 *   read-from-env path in @/lib/notifications/push.
 */

import { NextResponse } from 'next/server';
import { getVapidPublicKey } from '@/lib/notifications/push';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ publicKey: getVapidPublicKey() });
}
