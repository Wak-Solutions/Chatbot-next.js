/**
 * GET /api/surveys/active-summary — the small "Survey Overview" widget
 * on the Statistics page.
 *
 * Returns the calling tenant's active survey (if any) and a rollup of
 * the past 7 days' responses against it:
 *   - survey_id           — null if no active survey
 *   - title               — only populated when survey_id is non-null
 *   - weekly_sent         — survey_responses rows created in last 7d
 *   - weekly_submitted    — subset with submitted = true
 *   - avg_rating_this_week — AVG(answer_rating) over submitted responses
 *                           (rounded to 1 decimal; null when no ratings)
 *
 * Tenant-scoped via auth.companyId. The client renders a spinner while
 * the request is in flight and treats `survey_id: null` as "no active
 * survey" — so we always return a valid shape, never 404.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('surveys');

export const dynamic = 'force-dynamic';

interface ActiveSummaryRow {
  survey_id: number | null;
  title: string | null;
  weekly_sent: number | null;
  weekly_submitted: number | null;
  avg_rating_this_week: string | null;
}

export const GET = withAuth(async (_request, auth) => {
  try {
    const r = await getPool().query<ActiveSummaryRow>(
      `
      WITH active AS (
        SELECT id, title FROM surveys
        WHERE is_active = true AND company_id = $1
        LIMIT 1
      ),
      wk AS (
        SELECT
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS weekly_sent,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days' AND submitted = true)::int AS weekly_submitted
        FROM survey_responses
        WHERE survey_id = (SELECT id FROM active) AND company_id = $1
      ),
      rating AS (
        SELECT ROUND(AVG(sa.answer_rating)::numeric, 1) AS avg_rating_this_week
        FROM survey_answers sa
        JOIN survey_responses sr ON sr.id = sa.response_id
        WHERE sr.survey_id = (SELECT id FROM active)
          AND sr.company_id = $1
          AND sa.answer_rating IS NOT NULL
          AND sr.submitted = true
          AND sr.created_at > NOW() - INTERVAL '7 days'
      )
      SELECT
        (SELECT id FROM active) AS survey_id,
        (SELECT title FROM active) AS title,
        (SELECT weekly_sent FROM wk) AS weekly_sent,
        (SELECT weekly_submitted FROM wk) AS weekly_submitted,
        (SELECT avg_rating_this_week FROM rating) AS avg_rating_this_week
      `,
      [auth.companyId],
    );
    const row = r.rows[0];
    return NextResponse.json({
      survey_id: row?.survey_id ?? null,
      title: row?.title ?? undefined,
      weekly_sent: row?.weekly_sent ?? 0,
      weekly_submitted: row?.weekly_submitted ?? 0,
      avg_rating_this_week:
        row?.avg_rating_this_week != null ? Number(row.avg_rating_this_week) : null,
    });
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, err: (err as Error)?.message },
      'getActiveSurveySummary failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});
