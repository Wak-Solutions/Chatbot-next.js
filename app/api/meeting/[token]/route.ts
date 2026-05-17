/**
 * GET /api/meeting/[token] — port of server/routes/meetings.routes.ts:314-338.
 *
 * Public, rate-limited (publicTokenLimiter 20/15min/IP). Used by the
 * /meeting/:token page that customers reach via the branded link in the
 * booking-confirmation WhatsApp + email.
 *
 * Response intentionally omits company_id and any internal identifiers
 * other than what the customer needs to join (status, link, scheduled_at).
 * Hides the meeting_link when the meeting is completed or more than 2h
 * past its scheduled_at.
 *
 *   200: { meeting_link: string | null, scheduled_time: string | null, status: string }
 *   404: { message: 'Meeting not found.' }
 *   429: rate-limited
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { publicTokenLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('meeting');

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;

  const decision = publicTokenLimiter.check(`meeting:${clientIp(request)}`);
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
      id: number;
      meeting_link: string | null;
      scheduled_at: Date | null;
      status: string | null;
      company_id: number | null;
    }>(
      `SELECT id, meeting_link, scheduled_at, status, company_id
       FROM meetings WHERE meeting_token = $1 LIMIT 1`,
      [token],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ message: 'Meeting not found.' }, { status: 404 });
    }
    const m = result.rows[0];
    const scheduledTime = m.scheduled_at
      ? new Date(new Date(m.scheduled_at).getTime() + 3 * 60 * 60 * 1000).toISOString()
      : null;
    const isExpired =
      m.status === 'completed' ||
      (m.scheduled_at !== null &&
        new Date(m.scheduled_at).getTime() + 2 * 60 * 60 * 1000 < Date.now());
    return NextResponse.json({
      meeting_link: isExpired ? null : (m.meeting_link || null),
      scheduled_time: scheduledTime,
      status: m.status,
    });
  } catch (err) {
    logger.error(
      { token, ip: clientIp(request), err: (err as Error)?.message },
      'getMeeting failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}
