/**
 * GET /api/surveys/[id]/results — port of server/surveys.ts:429-515.
 *
 * Aggregated results: total sent/submitted/response-rate, per-question
 * stats (rating → avg + 1..5 distribution; yes_no → yes/no counts;
 * free_text → answers list), and per-agent stats.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('surveys');

export const dynamic = 'force-dynamic';

interface AnswerRow {
  question_id: number;
  answer_text: string | null;
  answer_rating: number | null;
  answer_yes_no: boolean | null;
}

interface QuestionRow {
  id: number;
  question_text: string;
  question_type: 'rating' | 'yes_no' | 'free_text';
  order_index: number;
}

export const GET = withAdmin<{ params: Promise<{ id: string }> }>(
  async (_request, auth, ctx) => {
    const { id } = await ctx.params;
    try {
      const surveyRes = await getPool().query(
        'SELECT * FROM surveys WHERE id=$1 AND company_id=$2',
        [id, auth.companyId],
      );
      if (surveyRes.rows.length === 0) {
        return NextResponse.json({ message: 'Survey not found' }, { status: 404 });
      }

      const totalRes = await getPool().query<{ total_sent: number; total_submitted: number }>(
        `SELECT COUNT(*)::int AS total_sent,
                COUNT(*) FILTER (WHERE submitted=true)::int AS total_submitted
         FROM survey_responses WHERE survey_id=$1 AND company_id=$2`,
        [id, auth.companyId],
      );
      const { total_sent, total_submitted } = totalRes.rows[0];

      const questionsRes = await getPool().query<QuestionRow>(
        'SELECT * FROM survey_questions WHERE survey_id=$1 ORDER BY order_index',
        [id],
      );

      const answersRes = await getPool().query<AnswerRow>(
        `SELECT sa.question_id, sa.answer_text, sa.answer_rating, sa.answer_yes_no
         FROM survey_answers sa
         JOIN survey_responses sr ON sr.id = sa.response_id
         WHERE sr.survey_id=$1 AND sr.submitted=true AND sr.company_id=$2`,
        [id, auth.companyId],
      );

      const answerMap = new Map<number, AnswerRow[]>();
      for (const a of answersRes.rows) {
        if (!answerMap.has(a.question_id)) answerMap.set(a.question_id, []);
        answerMap.get(a.question_id)!.push(a);
      }

      const questions = questionsRes.rows.map((q) => {
        const answers = answerMap.get(q.id) ?? [];
        if (q.question_type === 'rating') {
          const rated = answers.filter((a) => a.answer_rating != null);
          const avg = rated.length
            ? rated.reduce((s, a) => s + (a.answer_rating ?? 0), 0) / rated.length
            : null;
          const distribution: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
          for (const a of rated) {
            const k = String(a.answer_rating);
            distribution[k] = (distribution[k] || 0) + 1;
          }
          return {
            question_id: q.id,
            question_text: q.question_text,
            question_type: q.question_type,
            avg_score: avg != null ? parseFloat(avg.toFixed(1)) : null,
            distribution,
          };
        }
        if (q.question_type === 'yes_no') {
          const yes_count = answers.filter((a) => a.answer_yes_no === true).length;
          const no_count = answers.filter((a) => a.answer_yes_no === false).length;
          return {
            question_id: q.id,
            question_text: q.question_text,
            question_type: q.question_type,
            yes_count,
            no_count,
          };
        }
        return {
          question_id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          answers: answers.map((a) => a.answer_text).filter(Boolean),
        };
      });

      const agentRes = await getPool().query<{
        agent_id: number | null;
        chats_handled: number;
        avg_rating: string | null;
      }>(
        `SELECT sr.agent_id,
           COUNT(DISTINCT sr.id)::int AS chats_handled,
           ROUND(AVG(sa.answer_rating)::numeric, 1) AS avg_rating
         FROM survey_responses sr
         LEFT JOIN survey_answers sa ON sa.response_id = sr.id AND sa.answer_rating IS NOT NULL
         WHERE sr.survey_id=$1 AND sr.submitted=true AND sr.company_id=$2
         GROUP BY sr.agent_id`,
        [id, auth.companyId],
      );
      const per_agent = agentRes.rows.map((r) => ({
        agent_id: r.agent_id,
        agent_name: r.agent_id ? `Agent #${r.agent_id}` : 'Unknown',
        chats_handled: r.chats_handled,
        avg_rating: r.avg_rating ? parseFloat(r.avg_rating) : null,
      }));

      return NextResponse.json({
        total_sent,
        total_submitted,
        response_rate: total_sent > 0 ? Math.round((total_submitted / total_sent) * 100) : 0,
        questions,
        per_agent,
      });
    } catch (err) {
      logger.error(
        { surveyId: id, err: (err as Error)?.message },
        'getSurveyResults failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  },
);
