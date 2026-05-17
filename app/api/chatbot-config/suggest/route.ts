/**
 * POST /api/chatbot-config/suggest — port of
 * server/routes/chatbot-config.routes.ts:349-440.
 *
 * Takes a natural-language instruction, sends it to OpenAI alongside
 * the current structured config, and saves the model's returned config
 * via the same upsert path the normal save uses. Rate-limited per
 * company (openAiLimiter — 10/min).
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { compilePrompt, menuDepthValid } from '@/lib/llm/prompts/compile';
import { getOpenAI, getOpenAIModel } from '@/lib/llm/openai';
import { openAiLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('chatbot-config');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAdmin(async (request, auth) => {
    const decision = openAiLimiter.check(`openai:${auth.companyId}`);
    if (!decision.ok) {
      return NextResponse.json(
        { message: 'Too many AI requests, try again later' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
        },
      );
    }

    try {
      const { suggestion } = (await request.json()) as { suggestion?: string };
      const companyId = auth.companyId;

      if (!suggestion || typeof suggestion !== 'string' || !suggestion.trim()) {
        return NextResponse.json({ message: 'suggestion is required' }, { status: 400 });
      }
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json(
          { message: 'OPENAI_API_KEY is not configured on this server.' },
          { status: 503 },
        );
      }

      const existing = await getPool().query<{ id: number; structured_config: Record<string, unknown> | null }>(
        'SELECT id, structured_config FROM chatbot_config WHERE company_id = $1 ORDER BY id LIMIT 1',
        [companyId],
      );
      const currentConfig: Record<string, unknown> =
        existing.rows.length > 0 ? existing.rows[0].structured_config ?? {} : {};

      const systemPrompt = `You are a chatbot configuration editor. You will receive a structured config object and a plain English or Arabic instruction. Detect the language of the instruction and apply the change using that same language where the config fields contain natural language text (greeting, closingMessage, faq answers, escalationRules etc). Return ONLY a valid JSON object with the SAME shape as the input config — no extra keys, no missing keys, no explanation, no markdown. Apply the instruction intelligently to the correct field:
- businessName, industry, tone, greeting, closingMessage, servicesText: plain strings
- questions: ONLY qualification questions asked TO the customer to understand their needs. NEVER put pricing, routing, or contact logic here.
- faq: array of {id, question, answer} — factual Q&A about the business
- escalationRules: array of {id, rule} — conditions that trigger human handover OR routing logic like pricing responses, WhatsApp links (always use https://wa.me/966544798226), meeting booking triggers
- menuConfig: the nested menu structure — array of {id, label, subItems[]}
Apply the change to whichever field makes semantic sense. If the instruction says to change the entire bot behaviour or tone, update all relevant fields accordingly. If the instruction is in Arabic, write all natural language config values in Arabic. If in English, write in English. When adding new array items, generate a unique 7-character alphanumeric id for each.`;

      const userPrompt = `Current config:\n${JSON.stringify(currentConfig, null, 2)}\n\nInstruction: ${suggestion.trim()}`;

      const completion = await getOpenAI().chat.completions.create({
        model: getOpenAIModel(),
        max_tokens: 2000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? '';
      const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

      let newConfig: Record<string, unknown>;
      try {
        newConfig = JSON.parse(cleaned) as Record<string, unknown>;
      } catch {
        logger.error({ raw: cleaned.slice(0, 200) }, 'suggestChatbotConfig — JSON parse failed');
        return NextResponse.json(
          { message: 'OpenAI returned invalid JSON', raw: cleaned },
          { status: 400 },
        );
      }

      const expectedKeys = Object.keys(currentConfig);
      if (expectedKeys.length > 0) {
        const missingKeys = expectedKeys.filter((k) => !(k in newConfig));
        if (missingKeys.length > 0) {
          logger.error({ missingKeys }, 'suggestChatbotConfig — missing keys in response');
          return NextResponse.json(
            { message: `OpenAI response is missing keys: ${missingKeys.join(', ')}`, raw: cleaned },
            { status: 400 },
          );
        }
      }

      const menuItems = (newConfig as { menuConfig?: unknown[] }).menuConfig ?? [];
      if (!menuDepthValid(menuItems)) {
        return NextResponse.json(
          { message: 'AI suggested menu nesting that exceeds maximum depth of 3 levels' },
          { status: 400 },
        );
      }

      const activePrompt = compilePrompt(newConfig);

      let result;
      if (existing.rows.length > 0) {
        result = await getPool().query(
          `UPDATE chatbot_config
           SET system_prompt=$1, structured_config=$2, override_active=$3, demo_conversation=$4, updated_at=NOW()
           WHERE company_id=$5 RETURNING *`,
          [activePrompt, JSON.stringify(newConfig), false, JSON.stringify(null), companyId],
        );
      } else {
        result = await getPool().query(
          `INSERT INTO chatbot_config (system_prompt, structured_config, override_active, demo_conversation, updated_at, company_id)
           VALUES ($1,$2,$3,$4,NOW(),$5) RETURNING *`,
          [activePrompt, JSON.stringify(newConfig), false, JSON.stringify(null), companyId],
        );
      }

      logger.info(
        { companyId, prompt_length: activePrompt.length },
        'suggestChatbotConfig saved',
      );
      const system_prompt_preview = compilePrompt(newConfig);
      return NextResponse.json({ ...result.rows[0], system_prompt_preview });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'suggestChatbotConfig failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
