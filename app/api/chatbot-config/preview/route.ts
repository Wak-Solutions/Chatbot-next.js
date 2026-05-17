/**
 * POST /api/chatbot-config/preview — port of
 * server/routes/chatbot-config.routes.ts:336-344.
 *
 * Returns the compiled system prompt without persisting. Used by the
 * dashboard's structured-editor preview pane.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { compilePrompt } from '@/lib/llm/prompts/compile';

const logger = createLogger('chatbot-config');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const body = (await request.json()) as { structured_config?: Record<string, unknown> };
      const compiled = compilePrompt(body.structured_config || {});
      return NextResponse.json({ prompt: compiled });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'previewChatbotConfig failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
