/**
 * GET /api/statistics?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Port of server/routes/statistics.routes.ts:18-47.
 *
 * Returns:
 *   { totalCustomers: number,
 *     perDay: { date: 'YYYY-MM-DD', count: number }[] }
 *
 * Range constraints (mirror the original):
 *   - 'from' and 'to' both required
 *   - 'from' must be ≤ 'to'
 *   - range must be ≤ 366 days
 *
 * Tenant-scoped to AuthContext.companyId. The legacy server runs these
 * via storage.ts (Drizzle); we keep the same SQL shape against the pool.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('statistics');

const MAX_RANGE_DAYS = 366;

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (request, auth) => {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') ?? undefined;
  const to = url.searchParams.get('to') ?? undefined;
  if (!from || !to) {
    return NextResponse.json({ message: 'Missing from/to query params' }, { status: 400 });
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ message: 'Invalid date format' }, { status: 400 });
  }
  const rangeDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
  if (rangeDays < 0) {
    return NextResponse.json({ message: "'from' must be before 'to'" }, { status: 400 });
  }
  if (rangeDays > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { message: `Date range may not exceed ${MAX_RANGE_DAYS} days` },
      { status: 400 },
    );
  }

  try {
    const fromIso = fromDate.toISOString();
    const toIso = toDate.toISOString();
    const [totalRes, perDayRes] = await Promise.all([
      getPool().query<{ total: number }>(
        `SELECT COUNT(DISTINCT customer_phone)::int AS total
         FROM messages
         WHERE direction = 'inbound'
           AND company_id = $1
           AND created_at >= $2
           AND created_at <= $3`,
        [auth.companyId, fromIso, toIso],
      ),
      getPool().query<{ date: string; count: number }>(
        `SELECT
           DATE(created_at) AS date,
           COUNT(DISTINCT customer_phone)::int AS count
         FROM messages
         WHERE direction = 'inbound'
           AND company_id = $1
           AND created_at >= $2
           AND created_at <= $3
         GROUP BY DATE(created_at)
         ORDER BY date ASC`,
        [auth.companyId, fromIso, toIso],
      ),
    ]);

    return NextResponse.json({
      totalCustomers: totalRes.rows[0]?.total ?? 0,
      perDay: perDayRes.rows,
    });
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
      'getStatistics failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
