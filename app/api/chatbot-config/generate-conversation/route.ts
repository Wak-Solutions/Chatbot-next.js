/**
 * POST /api/chatbot-config/generate-conversation — port of
 * server/routes/chatbot-config.routes.ts:278-333.
 *
 * Sends a description + menuConfig to OpenAI and returns a JSON array
 * of `{ role: 'bot' | 'user', text: string }` demo turns the dashboard
 * renders as a preview chat. Rate-limited per company.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { generateText } from 'ai';
import { getModel } from '@/lib/llm/provider';
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
      const { companyName, description, services, feedback, menuConfig } =
        (await request.json()) as {
          companyName?: string;
          description?: string;
          services?: string;
          feedback?: string;
          menuConfig?: { label: string; subItems?: string[] }[];
        };

      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json(
          { message: 'OPENAI_API_KEY is not configured on this server.' },
          { status: 503 },
        );
      }

      const feedbackLine = feedback ? `User feedback to incorporate: ${feedback}` : '';

      const menuLines: string[] = [];
      const menuItems = menuConfig ?? [];
      if (menuItems.length > 0) {
        menuLines.push('Main menu the bot must present (numbered, exactly as listed):');
        menuItems.forEach((item, i) => {
          menuLines.push(`${i + 1}. ${item.label}`);
          (item.subItems || []).forEach((sub, j) => {
            menuLines.push(`   ${i + 1}.${j + 1}. ${sub}`);
          });
        });
        menuLines.push(
          'The bot must show this menu in the opening turn and guide the customer through the relevant sub-items. Never invent items not in this list.',
        );
      }

      const userPrompt = [
        'You are generating a realistic WhatsApp demo conversation for a business chatbot.',
        `Business: ${companyName || 'the business'}`,
        `Description: ${description || 'a customer service business'}`,
        `Products/Services: ${services || 'various products and services'}`,
        ...menuLines,
        feedbackLine,
        '',
        'Return ONLY a JSON array of message objects, no markdown, no explanation.',
        'Each object: { "role": "bot" | "user", "text": string }',
        'Generate 6-10 messages. Make it feel like a real customer interaction.',
        'The bot should be helpful, present the menu when appropriate, and guide the customer naturally through the listed options only.',
      ]
        .filter(Boolean)
        .join('\n');

      const completion = await generateText({
        model: getModel(),
        maxOutputTokens: 1000,
        messages: [{ role: 'user', content: userPrompt }],
      });

      const raw = completion.text || '[]';
      const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
      const conversation = JSON.parse(cleaned);

      logger.info(
        { companyId: auth.companyId, messages: Array.isArray(conversation) ? conversation.length : 0 },
        'generateConversation',
      );
      return NextResponse.json({ conversation });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'generateConversation failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
