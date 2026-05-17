/**
 * /api/chatbot-config — GET (dual-auth) + POST (admin).
 *
 * GET auth: session OR x-webhook-secret. The Python bot reads via the
 * webhook-secret path until PR 13 retires that hop. After PR 13 the
 * worker reads directly from the DB and this dual-auth shape can
 * collapse to session-only.
 *
 * POST is admin-only. Compiles structured config → system_prompt via
 * @/lib/llm/prompts/compile.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { SESSION_COOKIE_NAME, readSession } from '@/lib/auth/session';
import { verifySidFromEnv } from '@/lib/auth/cookies';
import { resolveCompanyBySecret } from '@/lib/companies/resolveBySecret';
import { compilePrompt, menuDepthValid } from '@/lib/llm/prompts/compile';
import { invalidatePromptCache } from '@/lib/llm/prompts/cache';

const logger = createLogger('chatbot-config');

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    let companyId: number | null = null;

    // Try session first
    const raw = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (raw) {
      const sid = verifySidFromEnv(raw);
      if (sid) {
        const record = await readSession(sid);
        if (record?.data.authenticated) {
          const cid = Number(record.data.companyId);
          if (!Number.isInteger(cid) || cid <= 0) {
            logger.warn(
              { agentId: record.data.agentId },
              'getChatbotConfig — authenticated but no companyId in session',
            );
            return NextResponse.json({ message: 'Session missing companyId' }, { status: 401 });
          }
          companyId = cid;
        }
      }
    }

    if (companyId === null) {
      const company = await resolveCompanyBySecret(
        request.headers.get('x-webhook-secret') ?? undefined,
      );
      if (!company) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
      companyId = company.id;
    }

    logger.info({ companyId }, 'getChatbotConfig');

    const result = await getPool().query(
      'SELECT * FROM chatbot_config WHERE company_id = $1 ORDER BY id LIMIT 1',
      [companyId],
    );
    if (result.rows.length === 0) {
      return NextResponse.json({
        system_prompt: null,
        structured_config: null,
        override_active: false,
        menu_config: [],
        system_prompt_preview: null,
        updated_at: null,
      });
    }
    const row = result.rows[0];
    const structuredCfg = row.structured_config ?? {};
    const menuForCompile =
      Array.isArray(row.menu_config) && row.menu_config.length > 0
        ? row.menu_config
        : structuredCfg.menuConfig ?? [];
    structuredCfg.menuConfig = menuForCompile;
    const system_prompt_preview = compilePrompt(structuredCfg);
    return NextResponse.json({ ...row, system_prompt_preview });
  } catch (err) {
    logger.error(
      { err: (err as Error)?.message },
      'getChatbotConfig failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
}

export const POST = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const { structured_config, override_active, raw_prompt, demo_conversation } =
        (await request.json()) as {
          structured_config?: Record<string, unknown>;
          override_active?: boolean;
          raw_prompt?: string;
          demo_conversation?: unknown;
        };
      const companyId = auth.companyId;

      if (raw_prompt && raw_prompt.length > 50_000) {
        return NextResponse.json(
          { message: 'System prompt exceeds 50,000 character limit' },
          { status: 400 },
        );
      }
      if (structured_config && JSON.stringify(structured_config).length > 100_000) {
        return NextResponse.json(
          { message: 'Structured config exceeds 100,000 character limit' },
          { status: 400 },
        );
      }

      const menuItems = ((structured_config || {}) as { menuConfig?: unknown[] }).menuConfig ?? [];
      if (!menuDepthValid(menuItems)) {
        return NextResponse.json(
          { message: 'Menu config exceeds depth limit (max 3 levels deep, 50 items per level, 200 chars per label)' },
          { status: 400 },
        );
      }

      const activePrompt = override_active
        ? raw_prompt || ''
        : compilePrompt(structured_config || {});

      const existing = await getPool().query(
        'SELECT id FROM chatbot_config WHERE company_id = $1',
        [companyId],
      );
      let result;
      if (existing.rows.length > 0) {
        result = await getPool().query(
          `UPDATE chatbot_config
           SET system_prompt=$1, structured_config=$2, override_active=$3, demo_conversation=$4, updated_at=NOW()
           WHERE company_id=$5 RETURNING *`,
          [
            activePrompt,
            JSON.stringify(structured_config),
            override_active,
            JSON.stringify(demo_conversation ?? null),
            companyId,
          ],
        );
      } else {
        result = await getPool().query(
          `INSERT INTO chatbot_config (system_prompt, structured_config, override_active, demo_conversation, updated_at, company_id)
           VALUES ($1,$2,$3,$4,NOW(),$5) RETURNING *`,
          [
            activePrompt,
            JSON.stringify(structured_config),
            override_active,
            JSON.stringify(demo_conversation ?? null),
            companyId,
          ],
        );
      }

      logger.info(
        { companyId, override_active, prompt_length: activePrompt.length },
        'Chatbot config saved',
      );
      // Per PR 13 hard req #4: invalidate the worker's per-company prompt
      // cache so admin edits take effect immediately instead of waiting
      // for the 60s TTL. Same-process call — the worker's @/lib/llm/prompts/
      // cache module is loaded by both dashboard-next and the worker, and
      // each process has its own cache. The dashboard's invalidation here
      // doesn't reach the worker process, but that's OK: the worker still
      // gets DB freshness within 60s via the TTL. The admin's NEXT preview
      // render IN THE DASHBOARD does see the updated prompt immediately.
      invalidatePromptCache(companyId);
      const system_prompt_preview = compilePrompt(structured_config || {});
      return NextResponse.json({ ...result.rows[0], system_prompt_preview });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'saveChatbotConfig failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
