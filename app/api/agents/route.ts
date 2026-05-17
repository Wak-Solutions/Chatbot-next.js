/**
 * /api/agents — GET (list with per-period filters) + POST (create).
 * Port of server/agents.ts:128-205.
 *
 * GET pre-aggregates meetings_per_agent and survey_per_agent in CTEs to
 * avoid N+1 subqueries — preserve verbatim (legacy fix CR-022).
 *
 * POST validates {name,email,password,role}, bcrypt-hashes the password,
 * inserts. 23505 → "Email already in use" 409.
 */

import bcrypt from 'bcrypt';
import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('agents');

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: z.enum(['agent', 'admin']),
});

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (request, auth) => {
  try {
    const periodParam = new URL(request.url).searchParams.get('period') ?? 'all';
    const period = ['today', 'week', 'month', 'all'].includes(periodParam) ? periodParam : 'all';
    const dateFilter =
      period === 'today'
        ? `AND e.created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')`
        : period === 'week'
          ? `AND e.created_at >= DATE_TRUNC('week', NOW() AT TIME ZONE 'UTC')`
          : period === 'month'
            ? `AND e.created_at >= DATE_TRUNC('month', NOW() AT TIME ZONE 'UTC')`
            : '';
    const result = await getPool().query(
      `
      WITH meetings_per_agent AS (
        SELECT m.agent_id, COUNT(*)::int AS meetings_completed
        FROM meetings m
        WHERE m.status = 'completed' AND m.company_id = $1
        GROUP BY m.agent_id
      ),
      survey_per_agent AS (
        SELECT sr.agent_id, ROUND(AVG(sa.answer_rating)::numeric, 1) AS avg_survey_rating
        FROM survey_answers sa
        JOIN survey_responses sr ON sr.id = sa.response_id
        WHERE sr.company_id = $1 AND sa.answer_rating IS NOT NULL
        GROUP BY sr.agent_id
      )
      SELECT
        a.id, a.name, a.email, a.role, a.is_active, a.last_login,
        COUNT(e.customer_phone) FILTER (
          WHERE e.status = 'closed' AND e.company_id = $1 ${dateFilter}
        )::int AS resolved_chats,
        COALESCE(mc.meetings_completed, 0) AS meetings_completed,
        sp.avg_survey_rating AS avg_survey_rating
      FROM agents a
      LEFT JOIN escalations e ON e.assigned_agent_id = a.id
      LEFT JOIN meetings_per_agent mc ON mc.agent_id = a.id
      LEFT JOIN survey_per_agent sp ON sp.agent_id = a.id
      WHERE a.company_id = $1
      GROUP BY a.id, mc.meetings_completed, sp.avg_survey_rating
      ORDER BY a.created_at
      `,
      [auth.companyId],
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    logger.error({ companyId: auth.companyId, err: (err as Error)?.message }, 'listAgents failed');
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});

export const POST = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const { name, email, password, role } = createSchema.parse(await request.json());
      const hash = await bcrypt.hash(password, 10);
      const result = await getPool().query(
        `INSERT INTO agents (name, email, password_hash, role, company_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, email, role, is_active, created_at`,
        [name, email, hash, role, auth.companyId],
      );
      logger.info({ agentId: result.rows[0].id, role }, 'Agent created');
      return NextResponse.json(result.rows[0], { status: 201 });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ message: 'Invalid input' }, { status: 400 });
      }
      if ((err as { code?: string }).code === '23505') {
        return NextResponse.json({ message: 'Email already in use.' }, { status: 409 });
      }
      logger.error(
        { companyId: auth.companyId, actorAgentId: auth.agentId, err: (err as Error)?.message },
        'createAgent failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
