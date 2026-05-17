/**
 * PUT /api/surveys/[id]/questions/reorder — port of server/surveys.ts:341-375.
 *
 * DIVERGENCE: plan says POST; original is PUT. Ported as PUT for
 * wire-compat. Flagged.
 *
 * Body: [{ id, order_index }]. Reorder in a single transaction via
 * @/lib/surveys/service.reorderQuestions.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { reorderQuestions } from '@/lib/surveys/service';

const logger = createLogger('surveys');

const bodySchema = z.array(z.object({ id: z.number(), order_index: z.number() }));

export const dynamic = 'force-dynamic';

export const PUT = withCsrf(
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
      const items = bodySchema.parse(await request.json());
      await reorderQuestions(id, auth.companyId, items);
      return NextResponse.json({ success: true });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
      }
      logger.error(
        { surveyId: id, err: (err as Error)?.message },
        'reorderSurveyQuestions failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
