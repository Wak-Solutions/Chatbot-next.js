/**
 * GET /api/demo-booking/[token] — port of server/routes/meetings.routes.ts:923-944.
 *
 * Public, rate-limited (publicTokenLimiter 20/15min/IP).
 *
 * Returns the demo booking by its meeting_token. Response only exposes
 * what the customer needs to join — meeting_link, scheduled_time, status.
 * No internal IDs or company info.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { publicTokenLimiter } from '@/lib/http/rateLimit';
import { KSA_OFFSET_MS } from '@/lib/meetings/timezone';

const logger = createLogger('demo-booking');

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  // Trust the RIGHTMOST X-Forwarded-For value. Railway terminates TLS at
  // exactly one proxy hop before the container, so the real client IP is
  // appended at the right end of the chain. Values on the left are
  // attacker-controlled — taking the leftmost lets a single client rotate
  // the key per request and defeat per-IP rate limits.
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;

  const decision = publicTokenLimiter.check(`demo-token:${clientIp(request)}`);
  if (!decision.ok) {
    return NextResponse.json(
      { message: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }

  try {
    const result = await getPool().query<{
      meeting_link: string | null;
      scheduled_at: Date | null;
      status: string;
    }>(
      `SELECT meeting_link, scheduled_at, status
       FROM demo_bookings WHERE meeting_token = $1 LIMIT 1`,
      [token],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ message: 'Demo booking not found.' }, { status: 404 });
    }
    const m = result.rows[0];
    const scheduledTime = m.scheduled_at
      ? new Date(new Date(m.scheduled_at).getTime() + KSA_OFFSET_MS).toISOString()
      : null;
    return NextResponse.json({
      meeting_link: m.meeting_link || null,
      scheduled_time: scheduledTime,
      status: m.status,
    });
  } catch (err) {
    logger.error(
      { token, ip: clientIp(request), err: (err as Error)?.message },
      'getDemoBooking failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}
