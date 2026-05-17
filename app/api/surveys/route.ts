/**
 * /api/surveys — GET (list with counts) + POST (create).
 * Port of server/surveys.ts:181-223.
 *
 * POST deactivates any existing active survey first, then INSERTs the
 * new survey with is_active=true — this satisfies the partial unique
 * index one_active_survey_per_company. On a race where another active
 * survey was created concurrently, the unique index will surface as a
 * 409 with the existing active survey (hard req #4).
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('surveys');

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
});

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (_request, auth) => {
  try {
    const result = await getPool().query(
      `SELECT s.*,
         (SELECT COUNT(*) FROM survey_questions sq WHERE sq.survey_id = s.id)::int AS question_count,
         (SELECT COUNT(*) FROM survey_responses sr WHERE sr.survey_id = s.id AND sr.company_id = $1)::int AS response_count,
         (SELECT COUNT(*) FROM survey_responses sr WHERE sr.survey_id = s.id AND sr.company_id = $1 AND sr.submitted = true)::int AS submitted_count
       FROM surveys s
       WHERE s.company_id = $1
       ORDER BY s.is_default DESC, s.created_at DESC`,
      [auth.companyId],
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    logger.error({ companyId: auth.companyId, err: (err as Error)?.message }, 'listSurveys failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});

export const POST = withCsrf(
  withAdmin(async (request, auth) => {
    const client = await getPool().connect();
    try {
      const { title, description } = createSchema.parse(await request.json());
      await client.query('BEGIN');
      await client.query(
        `UPDATE surveys SET is_active=false, updated_at=NOW() WHERE company_id=$1`,
        [auth.companyId],
      );
      const result = await client.query(
        `INSERT INTO surveys (title, description, company_id, is_active)
         VALUES ($1, $2, $3, true) RETURNING *`,
        [title, description, auth.companyId],
      );
      await client.query('COMMIT');
      return NextResponse.json(result.rows[0], { status: 201 });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err instanceof z.ZodError) {
        return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
      }
      // 23505 on the partial unique index = a concurrent activate beat us.
      // Surface the existing active row rather than 500 (hard req #4).
      if ((err as { code?: string }).code === '23505') {
        const existing = await getPool().query(
          `SELECT * FROM surveys WHERE is_active = true AND company_id = $1 LIMIT 1`,
          [auth.companyId],
        );
        return NextResponse.json(existing.rows[0] ?? {}, { status: 409 });
      }
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'createSurvey failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    } finally {
      client.release();
    }
  }),
);
