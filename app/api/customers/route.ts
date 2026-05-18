/**
 * GET /api/customers — port of server/routes/customers.routes.ts:19-94.
 *
 * DIVERGENCE: plan says withAuth, original uses requireAdmin. Going
 * with the more restrictive legacy behavior (admin-only) to avoid
 * silently widening access. Flagged.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('customers');

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (request, auth) => {
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;
  const search = (url.searchParams.get('search') ?? '').trim();
  const companyId = auth.companyId;

  try {
    const searchClause = search
      ? `AND (all_phones.phone ILIKE $4 OR cc.name ILIKE $4)`
      : '';
    const params: unknown[] = search
      ? [limit, offset, companyId, `%${search}%`]
      : [limit, offset, companyId];

    const rows = await getPool().query(
      `
      WITH all_phones AS (
        SELECT DISTINCT customer_phone AS phone FROM messages WHERE company_id = $3
        UNION SELECT DISTINCT customer_phone FROM escalations WHERE company_id = $3
        UNION SELECT DISTINCT customer_phone FROM meetings WHERE company_id = $3
      )
      SELECT
        all_phones.phone,
        cc.name, cc.source,
        MIN(m.created_at)  AS first_seen,
        MAX(m.created_at)  AS last_seen,
        (SELECT COUNT(*) FROM messages       WHERE customer_phone = all_phones.phone AND company_id = $3) +
        (SELECT COUNT(*) FROM escalations    WHERE customer_phone = all_phones.phone AND company_id = $3) +
        (SELECT COUNT(*) FROM meetings       WHERE customer_phone = all_phones.phone AND company_id = $3) +
        (SELECT COUNT(*) FROM survey_responses WHERE customer_phone = all_phones.phone AND company_id = $3) +
        (SELECT COUNT(*) FROM orders         WHERE customer_phone = all_phones.phone AND company_id = $3) AS touchpoints
      FROM all_phones
      LEFT JOIN contacts c ON c.phone_number = all_phones.phone
      LEFT JOIN contact_companies cc ON cc.contact_id = c.id AND cc.company_id = $3
      LEFT JOIN messages m ON m.customer_phone = all_phones.phone AND m.company_id = $3
      ${searchClause}
      GROUP BY all_phones.phone, cc.name, cc.source
      ORDER BY first_seen DESC NULLS LAST
      LIMIT $1 OFFSET $2
      `,
      params,
    );

    const totalParams: unknown[] = search ? [companyId, `%${search}%`] : [companyId];
    const totalQ = search
      ? `SELECT COUNT(*) FROM (
           SELECT DISTINCT all_phones.phone
           FROM (
             SELECT DISTINCT customer_phone AS phone FROM messages WHERE company_id = $1
             UNION SELECT DISTINCT customer_phone FROM escalations WHERE company_id = $1
             UNION SELECT DISTINCT customer_phone FROM meetings WHERE company_id = $1
           ) all_phones
           LEFT JOIN contacts c ON c.phone_number = all_phones.phone
           LEFT JOIN contact_companies cc ON cc.contact_id = c.id AND cc.company_id = $1
           WHERE all_phones.phone ILIKE $2 OR cc.name ILIKE $2
         ) t`
      : `SELECT COUNT(*) FROM (
           SELECT customer_phone FROM messages WHERE company_id = $1
           UNION SELECT customer_phone FROM escalations WHERE company_id = $1
           UNION SELECT customer_phone FROM meetings WHERE company_id = $1
         ) t`;
    const totalRes = await getPool().query(totalQ, totalParams);

    return NextResponse.json({
      customers: rows.rows.map((r: { phone: string; name: string | null; source: string | null; first_seen: Date | null; last_seen: Date | null; touchpoints: string | number }) => ({
        phone: r.phone,
        name: r.name || null,
        source: r.source || null,
        firstSeen: r.first_seen,
        lastSeen: r.last_seen,
        touchpoints: Number(r.touchpoints),
      })),
      total: Number(totalRes.rows[0].count),
      page,
    });
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
      'getCustomers failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
