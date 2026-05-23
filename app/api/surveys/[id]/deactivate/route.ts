/**
 * POST /api/surveys/[id]/deactivate — flips is_active to false on the
 * given survey, tenant-scoped via @/lib/surveys/service.deactivateSurvey.
 *
 * Companion to /activate. The surveys page calls this directly on the
 * Deactivate button — without this route the button silently 404s and
 * the list refreshes unchanged. Returns the updated row.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { deactivateSurvey } from '@/lib/surveys/service';

const logger = createLogger('surveys');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (_request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const row = await deactivateSurvey(id, auth.companyId);
      if (!row) {
        return NextResponse.json({ message: 'Survey not found' }, { status: 404 });
      }
      return NextResponse.json(row);
    } catch (err) {
      logger.error({ surveyId: id, err: (err as Error)?.message }, 'deactivateSurvey failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
