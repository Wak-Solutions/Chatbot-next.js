/**
 * GET /api/demo-booking/slots — port of server/routes/meetings.routes.ts:688-768.
 *
 * DIVERGENCE from original: the legacy handler is gated by requireAuth.
 * The PR 8 plan asks for this to be public. Going with the plan — the
 * response only exposes a slot calendar derived from WAK Solutions's
 * (company_id = 1) blocked_slots + work hours + booked-slot conflicts.
 * No tenant data is leaked. Flagging.
 *
 * Demo slot conflicts span demo_bookings AND meetings for company 1 —
 * they share the same calendar.
 */

import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { KSA_OFFSET_MS, formatKsaDate } from '@/lib/meetings/timezone';
import { getSlotsForDay } from '@/lib/meetings/slots';
import { getWorkHours } from '@/lib/companies/workHours';

const logger = createLogger('demo-booking');

const WAK_COMPANY_ID = 1;

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
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
        [WAK_COMPANY_ID, blockedWindowStart],
      ),
      getPool().query<{ scheduled_at: Date }>(
        `SELECT scheduled_at FROM demo_bookings
         WHERE scheduled_at >= $1 AND scheduled_at < $2
           AND status NOT IN ('completed', 'cancelled')
         UNION
         SELECT scheduled_at FROM meetings
         WHERE company_id = $3
           AND scheduled_at >= $1 AND scheduled_at < $2
           AND scheduled_at IS NOT NULL
           AND status NOT IN ('completed', 'cancelled')`,
        [windowStart, windowEnd, WAK_COMPANY_ID],
      ),
    ]);

    const workHours = await getWorkHours(WAK_COMPANY_ID);
    const blockedSet = new Set(blockedRes.rows.map((r: { date: string; time: string }) => `${r.date}T${r.time}`));
    const takenMs = new Set(takenRes.rows.map((r: { scheduled_at: Date }) => new Date(r.scheduled_at).getTime()));

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

    return NextResponse.json({ days });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, 'getDemoBookingSlots failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}
