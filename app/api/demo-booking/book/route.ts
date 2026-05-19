/**
 * POST /api/demo-booking/book — port of server/routes/meetings.routes.ts:775-920.
 *
 * Authenticated WAK Solutions admin flow (companyId === 1). The session
 * provides agent_id, name, and email; body carries only the slot. This
 * is NOT a customer-facing flow — it's how WAK staff seed demo bookings
 * for prospects they've spoken to. Making it public would change the
 * product (real Daily.co cost, no email verification, spam exposure) so
 * the original auth gate is preserved verbatim.
 *
 * Demo slot conflicts span demo_bookings AND meetings for company 1
 * (they share that tenant's calendar). The conflict probe reads from
 * the calendar_events view, which unions both tables and bakes
 * company_id = 1 into demo rows. demo_bookings.meeting_token is
 * omitted from the INSERT so the schema default `gen_random_uuid()`
 * fires (PR 8 hard req #3).
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { KSA_OFFSET_MS, formatKsaDateTime } from '@/lib/meetings/timezone';
import { getWorkHours } from '@/lib/companies/workHours';
import { isWithinWorkHours } from '@/lib/meetings/slots';
import { createDailyRoom } from '@/lib/integrations/daily';
import {
  getCompanyBranding,
  notifyManagerNewBooking,
  sendEmail,
  esc,
} from '@/lib/notifications/email';
import { notifyAll } from '@/lib/notifications/push';

const logger = createLogger('demo-booking');

const WAK_COMPANY_ID = 1;

const bodySchema = z.object({
  date: z.string(),
  time: z.string(),
});

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth(async (request, auth) => {
    if (auth.companyId !== WAK_COMPANY_ID) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    try {
      const { date, time } = bodySchema.parse(await request.json());

      // Agent info comes from the session — no body acceptance.
      const agentRes = await getPool().query<{ name: string | null; email: string | null }>(
        'SELECT name, email FROM agents WHERE id = $1',
        [auth.agentId],
      );
      const agent = agentRes.rows[0] ?? { name: null, email: null };

      const workHours = await getWorkHours(WAK_COMPANY_ID);
      if (!isWithinWorkHours(date, time, workHours)) {
        return NextResponse.json(
          { message: 'This time slot is outside working hours. Please choose another.' },
          { status: 400 },
        );
      }

      const [yr, mo, dy] = date.split('-').map(Number);
      const h = time === '00:00' ? 24 : parseInt(time.split(':')[0], 10);
      const scheduledUtc = new Date(Date.UTC(yr, mo - 1, dy, h - 3, 0, 0, 0));

      const blockedDateForCheck = new Date(Date.UTC(yr, mo - 1, dy) - KSA_OFFSET_MS)
        .toISOString()
        .slice(0, 10);
      const [takenRes, blockedRes] = await Promise.all([
        getPool().query(
          `SELECT 1 FROM calendar_events
           WHERE company_id = $3
             AND scheduled_at >= $1 AND scheduled_at < $2
             AND scheduled_at IS NOT NULL
             AND status NOT IN ('completed', 'cancelled')`,
          [scheduledUtc, new Date(scheduledUtc.getTime() + 3600000), WAK_COMPANY_ID],
        ),
        getPool().query(
          'SELECT 1 FROM blocked_slots WHERE company_id=$1 AND date=$2::date AND time=$3',
          [WAK_COMPANY_ID, blockedDateForCheck, time],
        ),
      ]);

      if (takenRes.rows.length > 0) {
        return NextResponse.json(
          { message: 'This time slot was just taken. Please choose another.' },
          { status: 409 },
        );
      }
      if (blockedRes.rows.length > 0) {
        return NextResponse.json(
          { message: 'This slot is not available. Please choose another.' },
          { status: 409 },
        );
      }

      const room = await createDailyRoom();
      const meetingLink = room.url;

      const ksaDt = new Date(scheduledUtc.getTime() + KSA_OFFSET_MS);
      const ksaLabel = formatKsaDateTime(ksaDt);

      await getPool().query(
        `INSERT INTO demo_bookings
           (agent_id, customer_name, customer_email, meeting_link, scheduled_at, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
        [auth.agentId || null, agent.name || 'demo', agent.email || '', meetingLink, scheduledUtc],
      );

      logger.info({ agentId: auth.agentId, time: ksaLabel }, 'Authenticated demo booked');

      notifyManagerNewBooking({
        companyId: WAK_COMPANY_ID,
        customerPhone: agent.name || 'Demo booking',
        dateTimeLabel: ksaLabel,
        meetingLink,
        scheduledUtc,
      }).catch((e: unknown) =>
        logger.error({ err: (e as Error)?.message }, 'Demo manager email failed'),
      );

      if (agent.email) {
        const { brandName: wakBrandName } = await getCompanyBranding(WAK_COMPANY_ID);
        const pad = (n: number) => String(n).padStart(2, '0');
        const fmt = (d: Date) =>
          `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
        const calEnd = new Date(scheduledUtc.getTime() + 3600000);
        const demoCalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`${wakBrandName} Demo`)}&dates=${fmt(scheduledUtc)}/${fmt(calEnd)}&details=${encodeURIComponent('Join your demo: ' + meetingLink)}&sf=true&output=xml`;
        const year = new Date().getFullYear();
        const demoConfirmHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <tr><td style="background:#0F510F;padding:28px 32px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${esc(wakBrandName)}</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-size:13px;">Demo Booking Confirmation</p>
        </td></tr>
        <tr><td style="padding:32px;">
          <p style="margin:0 0 24px;color:#222;font-size:15px;line-height:1.6;">Hi ${esc(agent.name) || 'there'},</p>
          <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6;">Your demo session with ${esc(wakBrandName)} is confirmed. We're excited to walk you through the platform and show you how it can transform your customer engagement. Please save the details below.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f9f0;border:1px solid #c8e6c9;border-radius:10px;margin-bottom:28px;">
            <tr><td style="padding:22px 26px;">
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Date &amp; Time (AST — UTC+3)</p>
              <p style="margin:0 0 20px;font-size:16px;font-weight:700;color:#0F510F;">${esc(ksaLabel)}</p>
              <p style="margin:0 0 4px;font-size:11px;color:#666;text-transform:uppercase;font-weight:700;">Meeting Link</p>
              <a href="${esc(meetingLink)}" style="font-size:14px;color:#0F510F;font-weight:600;word-break:break-all;">${esc(meetingLink)}</a><br />
              <a href="${esc(meetingLink)}" style="display:inline-block;margin-top:12px;background:#0F510F;color:#fff;text-decoration:none;padding:10px 22px;border-radius:6px;font-size:14px;font-weight:600;">Join Demo</a>
            </td></tr>
          </table>
          <a href="${demoCalUrl}" target="_blank" style="display:inline-block;background:#4285F4;color:#fff;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-weight:600;margin-bottom:28px;">&#128197; Add to Google Calendar</a>
          <p style="margin:0 0 10px;color:#444;font-size:14px;font-weight:700;">What to expect</p>
          <ul style="margin:0 0 24px;padding-left:20px;color:#555;font-size:13px;line-height:1.9;">
            <li>A live walkthrough of the ${esc(wakBrandName)} platform tailored to your use case.</li>
            <li>Time to ask questions and explore how the platform fits your team's workflow.</li>
            <li>No software to install — the meeting runs entirely in your browser.</li>
          </ul>
          <p style="margin:0;color:#555;font-size:13px;line-height:1.6;">If you need to reschedule, please get in touch with us and we'll find a time that works for you.</p>
        </td></tr>
        <tr><td style="background:#f9f9f9;border-top:1px solid #eee;padding:16px 32px;">
          <p style="margin:0;font-size:11px;color:#aaa;text-align:center;">&copy; ${year} ${esc(wakBrandName)}. All rights reserved.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
        sendEmail(
          agent.email,
          `Your demo with ${wakBrandName} is confirmed`,
          demoConfirmHtml,
        ).catch((e: unknown) =>
          logger.error({ err: (e as Error)?.message }, 'Demo confirmation email failed'),
        );
      }

      notifyAll(
        {
          title: 'Meeting Booked',
          body: `${agent.name || 'Agent'} — ${ksaLabel}`,
          url: '/meetings',
        },
        WAK_COMPANY_ID,
      ).catch((e: unknown) => logger.error({ err: (e as Error)?.message }, 'Demo push failed'));

      return NextResponse.json({
        success: true,
        ksa_label: ksaLabel,
        meeting_link: meetingLink,
      });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'bookAuthDemo failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
