/**
 * POST /api/surveys/[id]/questions — port of server/surveys.ts:312-338.
 *
 * Adds a question to a survey owned by the authed company. Question type
 * must be 'rating' | 'yes_no' | 'free_text'.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('surveys');

const bodySchema = z.object({
  question_text: z.string().min(1),
  question_type: z.enum(['rating', 'yes_no', 'free_text']),
  order_index: z.number().int(),
});

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const surveyCheck = await getPool().query(
        'SELECT id FROM surveys WHERE id=$1 AND company_id=$2',
        [id, auth.companyId],
      );
      if (surveyCheck.rows.length === 0) {
        return NextResponse.json({ message: 'Survey not found' }, { status: 404 });
      }

      const { question_text, question_type, order_index } = bodySchema.parse(
        await request.json(),
      );
      const result = await getPool().query(
        `INSERT INTO survey_questions (survey_id, question_text, question_type, order_index, company_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, question_text, question_type, order_index, auth.companyId],
      );
      return NextResponse.json(result.rows[0], { status: 201 });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
      }
      logger.error(
        { surveyId: id, err: (err as Error)?.message },
        'createSurveyQuestion failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
