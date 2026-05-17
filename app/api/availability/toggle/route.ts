/**
 * POST /api/availability/toggle — port of server/routes/meetings.routes.ts:245-273.
 *
 * Tenant-scoped block/unblock of a slot. If a row exists for
 * (companyId, date, time) we delete it; otherwise we insert. The INSERT
 * uses `ON CONFLICT (company_id, date, time) DO NOTHING` against the
 * named constraint `blocked_slots_company_date_time_key` (preserved
 * from PR 2 schema).
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('availability');

const bodySchema = z.object({ date: z.string(), time: z.string() });

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth(async (request, auth) => {
    try {
      const { date, time } = bodySchema.parse(await request.json());
      const companyId = auth.companyId;

      const existing = await getPool().query(
        'SELECT id FROM blocked_slots WHERE company_id=$1 AND date=$2::date AND time=$3',
        [companyId, date, time],
      );
      if (existing.rows.length > 0) {
        await getPool().query(
          'DELETE FROM blocked_slots WHERE company_id=$1 AND date=$2::date AND time=$3',
          [companyId, date, time],
        );
        logger.info({ companyId, date, time }, 'Slot unblocked');
        return NextResponse.json({ blocked: false });
      }
      await getPool().query(
        `INSERT INTO blocked_slots (company_id, date, time)
         VALUES ($1, $2::date, $3)
         ON CONFLICT ON CONSTRAINT blocked_slots_company_date_time_key DO NOTHING`,
        [companyId, date, time],
      );
      logger.info({ companyId, date, time }, 'Slot blocked');
      return NextResponse.json({ blocked: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'toggleAvailability failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
