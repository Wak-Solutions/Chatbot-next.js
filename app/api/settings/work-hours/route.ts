/**
 * GET /api/settings/work-hours — returns the caller's work hours
 *      { days, start, end, timezone } for the meetings/settings panel.
 *      Readable by any authenticated user (withAuth); falls back to the
 *      defaults getWorkHours() supplies when none are stored.
 * PUT /api/settings/work-hours — admin-only. Port of
 *      server/routes/settings.routes.ts:113-150. Per-field Zod validation
 *      with the original error messages preserved. IANA timezone validated
 *      via Intl.DateTimeFormat throw-on-unknown.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { getWorkHours, type WorkHours } from '@/lib/companies/workHours';

const logger = createLogger('settings');

const DAY = z.enum(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
const TIME = /^\d{2}:\d{2}$/;
const daysSchema = z.array(DAY);
const timeSchema = z.string().regex(TIME);
const tzSchema = z.string().min(1).max(64);

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request, auth) => {
  try {
    const wh = await getWorkHours(auth.companyId);
    return NextResponse.json(wh);
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, err: (err as Error)?.message },
      'getWorkHours failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});

export const PUT = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const body = ((await request.json()) ?? {}) as {
        days?: unknown;
        start?: unknown;
        end?: unknown;
        timezone?: unknown;
      };
      const { days, start, end, timezone } = body;

      if (!daysSchema.safeParse(days).success) {
        return NextResponse.json(
          { message: 'Invalid days — must be subset of Sun Mon Tue Wed Thu Fri Sat' },
          { status: 400 },
        );
      }
      if (!timeSchema.safeParse(start).success || !timeSchema.safeParse(end).success) {
        return NextResponse.json({ message: 'start and end must be HH:MM' }, { status: 400 });
      }
      if (typeof timezone !== 'string' || timezone.length === 0) {
        return NextResponse.json({ message: 'timezone is required' }, { status: 400 });
      }
      if (!tzSchema.safeParse(timezone).success) {
        return NextResponse.json({ message: 'timezone value is too long' }, { status: 400 });
      }
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch {
        return NextResponse.json({ message: `Unknown timezone: ${timezone}` }, { status: 400 });
      }

      const wh: WorkHours = {
        days: days as string[],
        start: start as string,
        end: end as string,
        timezone,
      };
      await getPool().query('UPDATE companies SET work_hours = $1 WHERE id = $2', [
        JSON.stringify(wh),
        auth.companyId,
      ]);
      logger.info(
        { companyId: auth.companyId, days: wh.days.join(','), start: wh.start, end: wh.end, tz: wh.timezone },
        'setWorkHours',
      );
      return NextResponse.json(wh);
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'setWorkHours failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
