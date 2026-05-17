/**
 * POST /api/statistics/summary — port of
 * server/routes/statistics.routes.ts:50-135.
 *
 * NOTE on HTTP shape: the original is a POST despite being read-only
 * (it accepts a JSON body and calls OpenAI without mutating our DB).
 * Listed in the PR-5 plan alongside the read-only batch, but ported as
 * POST to preserve the wire shape — the dashboard client already calls
 * it with POST.
 *
 *   { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' } → { summary: string }
 *
 * Constraints match the original (≤ 366 days, valid dates).
 * OPENAI_API_KEY missing → 503. OpenAI upstream non-2xx → 502.
 *
 * Tenant-scoping comes from AuthContext.companyId — body has no such field.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('statistics');

const MAX_RANGE_DAYS = 366;
const INBOUND_FETCH_LIMIT = 300;

const bodySchema = z.object({ from: z.string(), to: z.string() });

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth(async (request, auth) => {
    try {
      const parsed = bodySchema.parse(await request.json());
      const fromDate = new Date(parsed.from);
      const toDate = new Date(parsed.to);
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        return NextResponse.json({ message: 'Invalid date format' }, { status: 400 });
      }
      const rangeDays =
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
      if (rangeDays < 0 || rangeDays > MAX_RANGE_DAYS) {
        return NextResponse.json(
          { message: 'Date range must be between 0 and 366 days' },
          { status: 400 },
        );
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return NextResponse.json(
          {
            message:
              'OPENAI_API_KEY is not configured. Add it to wak-dash/.env and restart.',
          },
          { status: 503 },
        );
      }

      const fromIso = fromDate.toISOString();
      const toIso = toDate.toISOString();

      const msgsRes = await getPool().query<{
        customer_phone: string;
        message_text: string;
        created_at: Date;
      }>(
        `SELECT customer_phone, message_text, sender, created_at
         FROM messages
         WHERE direction = 'inbound'
           AND company_id = $1
           AND created_at >= $2
           AND created_at <= $3
         ORDER BY created_at DESC
         LIMIT ${INBOUND_FETCH_LIMIT}`,
        [auth.companyId, fromIso, toIso],
      );
      const msgs = msgsRes.rows;
      if (msgs.length === 0) {
        return NextResponse.json({
          summary: 'No customer messages found in the selected period.',
        });
      }

      const companyRes = await getPool().query<{ name: string | null }>(
        'SELECT name FROM companies WHERE id = $1',
        [auth.companyId],
      );
      const companyName = companyRes.rows[0]?.name ?? 'your company';

      const msgBlock = msgs
        .map(
          (m) =>
            `[${new Date(m.created_at).toLocaleDateString()}] ${m.customer_phone.replace(
              /^(.*)(.{4})$/,
              '****$2',
            )}: ${m.message_text.slice(0, 200)}`,
        )
        .join('\n');

      const prompt = [
        `You are reviewing customer support conversations for ${companyName}.`,
        `Period: ${fromDate.toDateString()} to ${toDate.toDateString()}. Total inbound messages: ${msgs.length}.`,
        ``,
        `Summarise the following customer messages in 3–5 sentences covering:`,
        `1. The most common topics or questions`,
        `2. Any recurring complaints or issues`,
        `3. Overall customer sentiment`,
        ``,
        `Messages (most recent first):`,
        msgBlock,
      ].join('\n');

      const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
      logger.info(
        { model, messages: msgs.length, from: parsed.from, to: parsed.to },
        'OpenAI summary request',
      );

      const openAiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 400,
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!openAiRes.ok) {
        const errText = await openAiRes.text();
        logger.error(
          { status: openAiRes.status, body: errText.slice(0, 200) },
          'OpenAI summary failed',
        );
        return NextResponse.json(
          { message: 'OpenAI request failed. Check server logs.' },
          { status: 502 },
        );
      }

      const json = (await openAiRes.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const summary: string =
        json.choices?.[0]?.message?.content?.trim() ?? 'Could not generate summary.';

      logger.info(
        { model, summary_chars: summary.length },
        'OpenAI summary success',
      );
      return NextResponse.json({ summary });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'getSummary failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
