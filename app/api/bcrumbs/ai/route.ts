/**
 * POST /api/bcrumbs/ai — Bread Crumbs "Custom AI" endpoint.
 *
 * Bread Crumbs POSTs a conversation; we run it through our existing chatbot
 * brain (getReply) and return the reply text. NOTHING is sent to Meta — this
 * is a synchronous request/response, fully separate from the Meta /webhook
 * (worker) and every send path.
 *
 * Auth:    x-api-key header, constant-time compared to BCRUMBS_API_KEY.
 * Tenant:  companies.bcrumbs_integration_id (then bcrumbs_workspace_id).
 * Memory:  getReply persists the inbound + loads history by (companyId,
 *          customerPhone); we persist the assistant reply here so the next
 *          turn sees it. customerPhone = externalClientId (stable per-user key).
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { getReply } from '@/worker/orchestrator/getReply';
import { saveMessage } from '@/lib/messaging/memory';

const logger = createLogger('bcrumbs-ai');

export const dynamic = 'force-dynamic';

const FALLBACK_TEXT = "Sorry, I couldn't generate a reply right now. Please try again.";
const APOLOGY_TEXT = 'Sorry, something went wrong on our side. Please try again in a moment.';

/** Constant-time string compare; false on any length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

interface BcrumbsMessage {
  role?: string;
  content?: string;
}
interface BcrumbsBody {
  externalClientId?: string;
  clientId?: string;
  conversationId?: string;
  workspaceId?: string;
  integrationId?: string;
  messages?: BcrumbsMessage[];
}

async function resolveCompanyId(
  integrationId: string | undefined,
  workspaceId: string | undefined,
): Promise<number | null> {
  const pool = getPool();
  if (integrationId) {
    const r = await pool.query<{ id: number }>(
      'SELECT id FROM companies WHERE bcrumbs_integration_id = $1 AND is_active = true LIMIT 1',
      [integrationId],
    );
    if (r.rows[0]) return r.rows[0].id;
  }
  if (workspaceId) {
    const r = await pool.query<{ id: number }>(
      'SELECT id FROM companies WHERE bcrumbs_workspace_id = $1 AND is_active = true LIMIT 1',
      [workspaceId],
    );
    if (r.rows[0]) return r.rows[0].id;
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth (constant-time). Unset server key or any mismatch → 401. ──
  const configuredKey = process.env.BCRUMBS_API_KEY;
  const presentedKey = request.headers.get('x-api-key') ?? '';
  if (!configuredKey || !safeEqual(presentedKey, configuredKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Pulled out so the catch can log identifying context even if parsing
  // populated only some of them.
  let workspaceId: string | undefined;
  let integrationId: string | undefined;
  let conversationId: string | undefined;

  try {
    const body = (await request.json()) as BcrumbsBody;
    workspaceId = body.workspaceId;
    integrationId = body.integrationId;
    conversationId = body.conversationId;

    const externalClientId = body.externalClientId;
    if (!externalClientId) {
      logger.warn({ workspaceId, integrationId, conversationId }, 'bcrumbs: missing externalClientId');
      return NextResponse.json({ text: FALLBACK_TEXT });
    }

    // Tenant mapping: integration first, then workspace. Each company is a
    // separate Bread Crumbs workspace, mapped via companies.bcrumbs_workspace_id
    // (set in dashboard Settings → Bread Crumbs). An unmapped workspace 404s
    // rather than silently routing to the wrong tenant.
    const companyId = await resolveCompanyId(integrationId, workspaceId);
    if (companyId === null) {
      logger.error(
        { workspaceId, integrationId, conversationId },
        'bcrumbs: no company mapped to integrationId/workspaceId',
      );
      return NextResponse.json({ error: 'No matching tenant' }, { status: 404 });
    }

    // newMessage = content of the LAST messages[] entry with role "user".
    const messages = Array.isArray(body.messages) ? body.messages : [];
    let newMessage = '';
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m?.role === 'user' && typeof m.content === 'string' && m.content.trim()) {
        newMessage = m.content;
        break;
      }
    }
    if (!newMessage) {
      logger.warn({ companyId, conversationId }, 'bcrumbs: no user message in payload');
      return NextResponse.json({ text: FALLBACK_TEXT });
    }

    // customerPhone = externalClientId (stable per-user history key).
    const customerPhone = String(externalClientId);

    // The brain. getReply persists the inbound + loads its own history; it
    // sends nothing outbound.
    const [reply, meetingMessage] = await getReply({ customerPhone, newMessage, companyId });

    const finalText = [reply, meetingMessage].filter(Boolean).join('\n\n') || FALLBACK_TEXT;

    // Persist the assistant turn so loadHistory includes it next time —
    // same helper/signature processText uses after it sends.
    await saveMessage({
      customerPhone,
      companyId,
      direction: 'outbound',
      messageText: finalText,
      sender: 'ai',
    });

    return NextResponse.json({ text: finalText });
  } catch (err) {
    // Always hand the customer a reply — Bread Crumbs expects 200 + text.
    logger.error(
      { workspaceId, integrationId, conversationId, err: (err as Error)?.message },
      'bcrumbs: AI handler failed',
    );
    return NextResponse.json({ text: APOLOGY_TEXT });
  }
}
