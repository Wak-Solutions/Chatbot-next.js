/**
 * GET /api/survey/[token] — port of server/surveys.ts:521-549.
 *
 * Public, rate-limited via publicTokenLimiter. Returns the survey
 * metadata + questions for a valid, unsubmitted, unexpired token.
 *   410 if invalid/expired/already submitted.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { publicTokenLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('survey-public');

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const decision = publicTokenLimiter.check(`survey:${clientIp(request)}`);
  if (!decision.ok) {
    return NextResponse.json(
      { message: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }
  try {
    const responseRes = await getPool().query(
      `SELECT sr.*, s.title, s.description
       FROM survey_responses sr
       JOIN surveys s ON s.id = sr.survey_id
       WHERE sr.token = $1`,
      [token],
    );
    if (responseRes.rows.length === 0) {
      return NextResponse.json(
        { message: 'Invalid or expired survey link.' },
        { status: 410 },
      );
    }
    const response = responseRes.rows[0];
    if (response.submitted) {
      return NextResponse.json(
        { message: 'This survey has already been submitted.' },
        { status: 410 },
      );
    }
    if (new Date(response.expires_at) < new Date()) {
      return NextResponse.json({ message: 'This survey link has expired.' }, { status: 410 });
    }

    const questionsRes = await getPool().query(
      `SELECT id, question_text, question_type, order_index
       FROM survey_questions WHERE survey_id=$1 ORDER BY order_index`,
      [response.survey_id],
    );
    return NextResponse.json({
      survey_id: response.survey_id,
      title: response.title,
      description: response.description,
      questions: questionsRes.rows,
    });
  } catch (err) {
    logger.error({ token, err: (err as Error)?.message }, 'getSurvey failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}
