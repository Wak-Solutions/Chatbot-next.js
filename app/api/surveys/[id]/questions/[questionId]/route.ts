/**
 * /api/surveys/[id]/questions/[questionId] — PUT + DELETE.
 * Port of server/surveys.ts:377-425.
 *
 * Both methods verify the parent survey belongs to the authed company
 * before touching the question.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('surveys');

const updateSchema = z.object({
  question_text: z.string().min(1),
  question_type: z.enum(['rating', 'yes_no', 'free_text']),
  order_index: z.number().int(),
});

export const dynamic = 'force-dynamic';

export const PUT = withCsrf(
  withAdmin<{ params: Promise<{ id: string; questionId: string }> }>(
    async (request, auth, ctx) => {
      const { id, questionId } = await ctx.params;
      try {
        const surveyCheck = await getPool().query(
          'SELECT id FROM surveys WHERE id=$1 AND company_id=$2',
          [id, auth.companyId],
        );
        if (surveyCheck.rows.length === 0) {
          return NextResponse.json({ message: 'Survey not found' }, { status: 404 });
        }
        const { question_text, question_type, order_index } = updateSchema.parse(
          await request.json(),
        );
        const result = await getPool().query(
          `UPDATE survey_questions
           SET question_text=$1, question_type=$2, order_index=$3
           WHERE id=$4 AND survey_id=$5 AND company_id=$6 RETURNING *`,
          [question_text, question_type, order_index, questionId, id, auth.companyId],
        );
        if (result.rows.length === 0) {
          return NextResponse.json({ message: 'Question not found' }, { status: 404 });
        }
        return NextResponse.json(result.rows[0]);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
        }
        logger.error(
          { surveyId: id, questionId, err: (err as Error)?.message },
          'updateSurveyQuestion failed',
        );
        return NextResponse.json({ message: 'Internal error' }, { status: 500 });
      }
    },
  ),
);

export const DELETE = withCsrf(
  withAdmin<{ params: Promise<{ id: string; questionId: string }> }>(
    async (_request, auth, ctx) => {
      const { id, questionId } = await ctx.params;
      try {
        const surveyCheck = await getPool().query(
          'SELECT id FROM surveys WHERE id=$1 AND company_id=$2',
          [id, auth.companyId],
        );
        if (surveyCheck.rows.length === 0) {
          return NextResponse.json({ message: 'Survey not found' }, { status: 404 });
        }
        await getPool().query(
          `DELETE FROM survey_questions WHERE id=$1 AND survey_id=$2 AND company_id=$3`,
          [questionId, id, auth.companyId],
        );
        return NextResponse.json({ success: true });
      } catch (err) {
        logger.error(
          { surveyId: id, questionId, err: (err as Error)?.message },
          'deleteSurveyQuestion failed',
        );
        return NextResponse.json({ message: 'Internal error' }, { status: 500 });
      }
    },
  ),
);
