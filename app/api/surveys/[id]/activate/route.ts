/**
 * POST /api/surveys/[id]/activate — port of server/surveys.ts:281-294.
 *
 * Atomic deactivate-others + activate-this in a single transaction
 * (hard req #5) via @/lib/surveys/service.activateSurvey. Honors the
 * one_active_survey_per_company partial unique index — at no point can
 * the company end up with two active surveys or zero.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { activateSurvey } from '@/lib/surveys/service';

const logger = createLogger('surveys');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (_request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const result = await activateSurvey(id, auth.companyId);
      if (!result.ok && result.notFound) {
        return NextResponse.json({ message: 'Survey not found' }, { status: 404 });
      }
      return NextResponse.json(result.survey);
    } catch (err) {
      logger.error({ surveyId: id, err: (err as Error)?.message }, 'activateSurvey failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
