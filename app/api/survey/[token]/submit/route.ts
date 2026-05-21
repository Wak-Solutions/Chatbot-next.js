/**
 * POST /api/survey/[token]/submit — port of server/surveys.ts:551-588.
 *
 * Public, rate-limited via publicTokenLimiter. Writes survey_answers
 * rows + flips survey_responses.submitted in a single transaction.
 *
 * 410 if invalid/expired/already submitted.
 */

import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { publicTokenLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('survey-public');

const answersSchema = z.array(
  z.object({
    question_id: z.number(),
    answer_text: z.string().max(5_000).optional().nullable(),
    answer_rating: z.number().int().min(1).max(5).optional().nullable(),
    answer_yes_no: z.boolean().optional().nullable(),
  }),
);

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  // Trust the RIGHTMOST X-Forwarded-For value. Railway terminates TLS at
  // exactly one proxy hop before the container, so the real client IP is
  // appended at the right end of the chain. Values on the left are
  // attacker-controlled — taking the leftmost lets a single client rotate
  // the key per request and defeat per-IP rate limits.
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const decision = publicTokenLimiter.check(`survey-submit:${clientIp(request)}`);
  if (!decision.ok) {
    return NextResponse.json(
      { message: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }
  const client = await getPool().connect();
  try {
    const responseRes = await client.query(
      `SELECT * FROM survey_responses WHERE token=$1`,
      [token],
    );
    if (responseRes.rows.length === 0) {
      return NextResponse.json({ message: 'Invalid survey link.' }, { status: 410 });
    }
    const response = responseRes.rows[0];
    if (response.submitted) {
      return NextResponse.json({ message: 'Already submitted.' }, { status: 410 });
    }
    if (new Date(response.expires_at) < new Date()) {
      return NextResponse.json({ message: 'Link expired.' }, { status: 410 });
    }

    const body = (await request.json()) as { answers?: unknown };
    const answers = answersSchema.parse(body.answers ?? []);

    if (!response.company_id) {
      return NextResponse.json(
        { message: 'Missing company_id on survey_response' },
        { status: 400 },
      );
    }

    await client.query('BEGIN');
    for (const a of answers) {
      await client.query(
        `INSERT INTO survey_answers (response_id, question_id, answer_text, answer_rating, answer_yes_no, company_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          response.id,
          a.question_id,
          a.answer_text ?? null,
          a.answer_rating ?? null,
          a.answer_yes_no ?? null,
          response.company_id,
        ],
      );
    }
    await client.query(
      `UPDATE survey_responses SET submitted=true, submitted_at=NOW() WHERE id=$1`,
      [response.id],
    );
    await client.query('COMMIT');
    return NextResponse.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
    }
    logger.error({ token, err: (err as Error)?.message }, 'submitSurvey failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  } finally {
    client.release();
  }
}
