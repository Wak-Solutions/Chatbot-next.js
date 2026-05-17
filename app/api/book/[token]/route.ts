/**
 * /api/book/[token] — port of server/routes/meetings.routes.ts:341-652.
 *
 * GET  → return available booking slots for the token's customer.
 * POST → confirm a slot, create the Daily.co room, write meeting_link
 *        + scheduled_at, fire admin/customer emails and push notifications.
 *
 * Public, rate-limited (bookingLimiter 10/15min/IP — corrected in PR 7).
 * URL path and :token semantics are baked into existing emails and
 * WhatsApp links already in the wild — do NOT change.
 *
 * Daily.co failure mode: if createDailyRoom throws, the POST currently
 * propagates the error (matches the original — no fallback in the
 * existing handler; hard req #6 says "fall back to no meeting_link and
 * email admins anyway" but the legacy code does NOT do that — porting
 * exactly per the "match existing behavior" half of the same req).
 * Tracked in docs/migration-divergences.md as a contradiction in the
 * hard-requirement text.
 */

import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { bookingLimiter } from '@/lib/http/rateLimit';
import { KSA_OFFSET_MS, formatKsaDate, formatKsaDateTime } from '@/lib/meetings/timezone';
import { getSlotsForDay, isWithinWorkHours } from '@/lib/meetings/slots';
import { getWorkHours } from '@/lib/companies/workHours';
import { createDailyRoom } from '@/lib/integrations/daily';
import {
  getCompanyBranding,
  notifyManagerNewBooking,
  sendEmail,
  esc,
} from '@/lib/notifications/email';
import { sendWhatsAppText } from '@/lib/messaging/whatsapp';
import { notifyAgent, notifyAll } from '@/lib/notifications/push';

const logger = createLogger('book');

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function checkRateLimit(request: NextRequest): NextResponse | null {
  const decision = bookingLimiter.check(`book:${clientIp(request)}`);
  if (!decision.ok) {
    return NextResponse.json(
      { message: 'Too many requests, please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }
  return null;
}

// ─── GET /api/book/[token] ────────────────────────────────────────────────

interface MeetingHeaderRow {
  id: number;
  customer_phone: string;
  scheduled_at: Date | null;
  status: string;
  token_expires_at: Date;
  company_id: number;
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const limited = checkRateLimit(request);
  if (limited) return limited;

  const { token } = await ctx.params;
  try {
    const mtg = await getPool().query<MeetingHeaderRow>(
      `SELECT id, customer_phone, scheduled_at, status, token_expires_at, company_id
       FROM meetings WHERE meeting_token = $1 LIMIT 1`,
      [token],
    );
    if (mtg.rows.length === 0) {
      return NextResponse.json({ message: 'Invalid booking link.' }, { status: 404 });
    }
    const meeting = mtg.rows[0];
    const companyId = meeting.company_id;
    if (new Date(meeting.token_expires_at) < new Date()) {
      return NextResponse.json({ message: 'This booking link has expired.' }, { status: 410 });
    }
    if (meeting.scheduled_at) {
      const ksaTime = new Date(new Date(meeting.scheduled_at).getTime() + KSA_OFFSET_MS);
      return NextResponse.json({
        alreadyBooked: true,
        scheduled_at: meeting.scheduled_at,
        ksa_label: formatKsaDateTime(ksaTime),
      });
    }

    const now = new Date();
    const ksaNow = new Date(now.getTime() + KSA_OFFSET_MS);
    const windowStart = new Date(now);
    windowStart.setUTCHours(0, 0, 0, 0);
    const windowEnd = new Date(windowStart.getTime() + 31 * 24 * 3600 * 1000);

    const ksaWindowStart = ksaNow.toISOString().slice(0, 10);
    const [ksaYr, ksaMo, ksaDy] = ksaWindowStart.split('-').map(Number);
    const blockedWindowStart = new Date(Date.UTC(ksaYr, ksaMo - 1, ksaDy) - KSA_OFFSET_MS)
      .toISOString()
      .slice(0, 10);

    const [blockedRes, takenRes] = await Promise.all([
      getPool().query<{ date: string; time: string }>(
        `SELECT date::text, time FROM blocked_slots
         WHERE company_id = $1
           AND date >= $2::date AND date < $2::date + INTERVAL '32 days'`,
        [companyId, blockedWindowStart],
      ),
      getPool().query<{ scheduled_at: Date }>(
        `SELECT scheduled_at FROM meetings
         WHERE scheduled_at >= $1 AND scheduled_at < $2
           AND status NOT IN ('completed', 'cancelled') AND id != $3
           AND company_id = $4
         UNION ALL
         SELECT scheduled_at FROM demo_bookings
         WHERE $4 = 1
           AND scheduled_at >= $1 AND scheduled_at < $2
           AND status NOT IN ('completed', 'cancelled')`,
        [windowStart, windowEnd, meeting.id, companyId],
      ),
    ]);

    const workHours = await getWorkHours(companyId);
    const blockedSet = new Set(blockedRes.rows.map((r) => `${r.date}T${r.time}`));
    const takenMs = new Set(takenRes.rows.map((r) => new Date(r.scheduled_at).getTime()));

    const days: { date: string; label: string; slots: string[]; bookedSlots: string[] }[] = [];

    for (let i = 0; i <= 30; i++) {
      const d = new Date(ksaNow);
      d.setUTCDate(d.getUTCDate() + i);
      const ksaDate = d.toISOString().slice(0, 10);
      const [yr, mo, dy] = ksaDate.split('-').map(Number);
      const blockedDate = new Date(Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS)
        .toISOString()
        .slice(0, 10);

      const availableSlots: string[] = [];
      const bookedSlots: string[] = [];
      const daySlots = getSlotsForDay(d.getUTCDay(), workHours);
      for (const slot of daySlots) {
        if (blockedSet.has(`${blockedDate}T${slot}`)) continue;
        const h = slot === '00:00' ? 24 : parseInt(slot.split(':')[0], 10);
        const slotUtc = new Date(Date.UTC(yr, mo - 1, dy, h - 3, 0, 0, 0));
        if (slotUtc <= now) continue;
        if (takenMs.has(slotUtc.getTime())) bookedSlots.push(slot);
        else availableSlots.push(slot);
      }
      if (availableSlots.length > 0 || bookedSlots.length > 0) {
        days.push({ date: ksaDate, label: formatKsaDate(d), slots: availableSlots, bookedSlots });
      }
    }

    return NextResponse.json({ valid: true, days });
  } catch (err) {
    logger.error(
      { token, ip: clientIp(request), err: (err as Error)?.message },
      'getBookingSlots failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}

// ─── POST /api/book/[token] ───────────────────────────────────────────────

const bookSchema = z.object({
  date: z.string(),
  time: z.string(),
  customerEmail: z.string().email().optional().or(z.literal('')),
});

interface BookRowFull {
  id: number;
  customer_phone: string;
  meeting_token: string;
  scheduled_at: Date | null;
  token_expires_at: Date;
  agent_id: number | null;
  company_id: number;
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const limited = checkRateLimit(request);
  if (limited) return limited;

  const { token } = await ctx.params;
  try {
    const parsed = bookSchema.parse(await request.json());
    const { date, time, customerEmail } = parsed;

    const mtg = await getPool().query<BookRowFull>(
      `SELECT id, customer_phone, meeting_token, scheduled_at, token_expires_at, agent_id, company_id
       FROM meetings WHERE meeting_token = $1 LIMIT 1`,
      [token],
    );
    if (mtg.rows.length === 0) {
      return NextResponse.json({ message: 'Invalid booking link.' }, { status: 404 });
    }
    const meeting = mtg.rows[0];
    const companyId = meeting.company_id;
    if (new Date(meeting.token_expires_at) < new Date()) {
      return NextResponse.json({ message: 'This booking link has expired.' }, { status: 410 });
    }

    const workHours = await getWorkHours(companyId);
    if (!isWithinWorkHours(date, time, workHours)) {
      return NextResponse.json(
        { message: 'This time slot is outside working hours. Please choose another.' },
        { status: 400 },
      );
    }

    const [yr, mo, dy] = date.split('-').map(Number);
    const h = time === '00:00' ? 24 : parseInt(time.split(':')[0], 10);
    const scheduledUtc = new Date(Date.UTC(yr, mo - 1, dy, h - 3, 0, 0, 0));

    // External call, kept outside the tx — matches original ordering.
    const room = await createDailyRoom();
    const meetingLink = room.url;

    let appUrl: string;
    let brandName: string;
    try {
      ({ appUrl, brandName } = await getCompanyBranding(companyId));
    } catch {
      logger.error({ companyId }, 'bookMeeting failed — app_url not set');
      return NextResponse.json(
        {
          message:
            'Booking is not configured. Please set your App URL in Settings → Branding before accepting bookings.',
        },
        { status: 400 },
      );
    }
    const brandedLink = `${appUrl}/meeting/${meeting.meeting_token}`;

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');

      const lockResult = await client.query<{ id: number; scheduled_at: Date | null }>(
        'SELECT id, scheduled_at FROM meetings WHERE meeting_token = $1 FOR UPDATE',
        [token],
      );
      if (lockResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ message: 'Not found' }, { status: 404 });
      }
      if (lockResult.rows[0].scheduled_at) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { message: 'This meeting is already booked.' },
          { status: 409 },
        );
      }

      const blockedDateForCheck = new Date(Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS)
        .toISOString()
        .slice(0, 10);
      const [takenRes, blockedRes] = await Promise.all([
        client.query(
          `SELECT 1 FROM meetings
           WHERE scheduled_at >= $1 AND scheduled_at < $2
             AND status NOT IN ('completed', 'cancelled') AND id != $3
             AND company_id = $4
           UNION
           SELECT 1 FROM demo_bookings
           WHERE $4 = 1
             AND scheduled_at >= $1 AND scheduled_at < $2
             AND status NOT IN ('completed', 'cancelled')`,
          [scheduledUtc, new Date(scheduledUtc.getTime() + 3600000), meeting.id, companyId],
        ),
        client.query(
          'SELECT 1 FROM blocked_slots WHERE company_id=$1 AND date=$2::date AND time=$3',
          [companyId, blockedDateForCheck, time],
        ),
      ]);

      if (takenRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { message: 'This time slot was just taken. Please choose another.' },
          { status: 409 },
        );
      }
      if (blockedRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { message: 'This slot is not available. Please choose another.' },
          { status: 409 },
        );
      }

      await client.query(
        `UPDATE meetings SET meeting_link=$1, scheduled_at=$2, link_sent=FALSE, customer_email=$3
         WHERE id=$4 AND company_id=$5`,
        [meetingLink, scheduledUtc, customerEmail || null, meeting.id, companyId],
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const ksaDt = new Date(scheduledUtc.getTime() + KSA_OFFSET_MS);
    const ksaLabel = formatKsaDateTime(ksaDt);
    logger.info({ phone: maskPhone(meeting.customer_phone), time: ksaLabel }, 'Meeting booked');

    notifyManagerNewBooking({
      companyId,
      customerPhone: meeting.customer_phone,
      dateTimeLabel: ksaLabel,
      meetingLink: brandedLink,
      scheduledUtc,
    }).catch((e: unknown) => logger.error({ err: (e as Error)?.message }, 'Manager email failed'));

    sendWhatsAppText({
      companyId,
      phone: meeting.customer_phone,
      body: `Your meeting with ${brandName} is confirmed for ${ksaLabel} (KSA time).\n\nJoin here: ${brandedLink}\n\nWe'll send you a reminder 15 minutes before the meeting starts.`,
    }).catch((e: unknown) =>
      logger.error({ err: (e as Error)?.message }, 'Booking WhatsApp failed'),
    );

    const meetingPush = {
      title: 'Meeting Booked',
      body: `${maskPhone(meeting.customer_phone)} — ${ksaLabel}`,
      url: '/meetings',
    };
    logger.info({ agentId: meeting.agent_id ?? 'unassigned' }, 'Sending meeting booked push');
    if (meeting.agent_id) {
      notifyAgent(meeting.agent_id, meetingPush).catch((e: unknown) =>
        logger.error({ err: (e as Error)?.message }, 'Push failed'),
      );
    } else {
      notifyAll(meetingPush, companyId).catch((e: unknown) =>
        logger.error({ err: (e as Error)?.message }, 'Push failed'),
      );
    }

    if (customerEmail) {
      const pad = (n: number) => String(n).padStart(2, '0');
      const fmt = (d: Date) =>
        `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
      const calEnd = new Date(scheduledUtc.getTime() + 3600000);
      const customerCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
        `Meeting with ${brandName}`,
      )}&dates=${fmt(scheduledUtc)}/${fmt(calEnd)}&details=${encodeURIComponent('Join your meeting: ' + brandedLink)}&sf=true&output=xml`;
      const year = new Date().getFullYear();
      const customerConfirmHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#0F510F;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${esc(brandName)}</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">Meeting Confirmation</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;color:#222;font-size:15px;line-height:1.6;">Your meeting with ${esc(brandName)} is confirmed. We look forward to connecting with you — please save the details below so you have everything you need on the day.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f0;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:28px;">
            <tr><td style="padding:22px 26px;">
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Date &amp; Time (AST — UTC+3)</p>
              <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#0F510F;">${esc(ksaLabel)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Meeting Link</p>
              <a href="${esc(brandedLink)}" style="font-size:14px;color:#0F510F;font-weight:600;word-break:break-all;">${esc(brandedLink)}</a><br />
              <a href="${esc(brandedLink)}" style="display:inline-block;margin-top:12px;background:#0F510F;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;">Join Meeting</a>
            </td></tr>
          </table>
          <a href="${customerCalUrl}" target="_blank" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600;margin-bottom:28px;">&#128197; Add to Google Calendar</a>
          <p style="margin:0 0 10px;color:#444;font-size:14px;font-weight:700;">Before your meeting</p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:13px;line-height:1.9;">
            <li>Use the link above to join — no software installation required, it opens in your browser.</li>
            <li>Find a quiet spot with a stable internet connection a few minutes before the scheduled time.</li>
            <li>You will receive a WhatsApp reminder 15 minutes before the meeting starts.</li>
          </ul>
          <p style="margin:0;color:#555;font-size:13px;line-height:1.6;">Need to reschedule or have a question? Simply reply to us on WhatsApp and we will be happy to help.</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">&copy; ${year} ${esc(brandName)}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
      sendEmail(
        customerEmail,
        `Your meeting with ${brandName} is confirmed`,
        customerConfirmHtml,
      ).catch((e: unknown) =>
        logger.error({ err: (e as Error)?.message }, 'Customer confirmation email failed'),
      );
    }

    return NextResponse.json({ success: true, ksa_label: ksaLabel });
  } catch (err) {
    logger.error(
      { token, ip: clientIp(request), err: (err as Error)?.message },
      'bookMeeting failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}
