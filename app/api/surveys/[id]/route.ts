/**
 * /api/surveys/[id] — GET + PUT + DELETE.
 * Port of server/surveys.ts:225-279.
 *
 * GET returns survey + ordered questions.
 * PUT updates title/description.
 * DELETE refuses if is_default — the default survey is bound by FK
 *        references and the legacy code blocks deletion.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('surveys');

const updateSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
});

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ params: Promise<{ id: string }> }>(
  async (_request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const surveyRes = await getPool().query(
        'SELECT * FROM surveys WHERE id = $1 AND company_id = $2',
        [id, auth.companyId],
      );
      if (surveyRes.rows.length === 0) {
        return NextResponse.json({ message: 'Survey not found' }, { status: 404 });
      }
      const questionsRes = await getPool().query(
        'SELECT * FROM survey_questions WHERE survey_id = $1 AND company_id = $2 ORDER BY order_index',
        [id, auth.companyId],
      );
      return NextResponse.json({ ...surveyRes.rows[0], questions: questionsRes.rows });
    } catch (err) {
      logger.error({ surveyId: id, err: (err as Error)?.message }, 'getSurvey failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  },
);

export const PUT = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const { title, description } = updateSchema.parse(await request.json());
      const result = await getPool().query(
        `UPDATE surveys SET title=$1, description=$2, updated_at=NOW()
         WHERE id=$3 AND company_id=$4 RETURNING *`,
        [title, description, id, auth.companyId],
      );
      if (result.rows.length === 0) {
        return NextResponse.json({ message: 'Survey not found' }, { status: 404 });
      }
      return NextResponse.json(result.rows[0]);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
      }
      logger.error({ surveyId: id, err: (err as Error)?.message }, 'updateSurvey failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);

export const DELETE = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (_request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const survey = await getPool().query<{ is_default: boolean | null }>(
        'SELECT is_default FROM surveys WHERE id=$1 AND company_id=$2',
        [id, auth.companyId],
      );
      if (survey.rows.length === 0) {
        return NextResponse.json({ message: 'Survey not found' }, { status: 404 });
      }
      if (survey.rows[0].is_default) {
        return NextResponse.json(
          { message: 'The default survey cannot be deleted.' },
          { status: 403 },
        );
      }
      await getPool().query('DELETE FROM surveys WHERE id=$1 AND company_id=$2', [id, auth.companyId]);
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error({ surveyId: id, err: (err as Error)?.message }, 'deleteSurvey failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
