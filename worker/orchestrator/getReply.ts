/**
 * The full inbound→reply orchestration. Port of Chatbot/agent.py.
 *
 * 10-step pipeline:
 *   1.  Load history (lib/messaging/memory.loadHistory).
 *   1a. Persist inbound BEFORE any network call (unless caller already
 *       saved it — audio worker passes saveInbound=false).
 *   2.  notifyDashboard('message', ...) — in-process (lib/notifications/
 *       dashboard), no HTTP hop.
 *   2a. Deterministic 1/2 next-step router. The system prompt instructs
 *       the LLM to end every reply with a "1. Book a meeting / 2. Chat
 *       with an agent" menu; when the customer answers 1 or 2 we route
 *       deterministically, bypassing the LLM. PORTED VERBATIM — same
 *       regex, same priority, same response strings.
 *   2b. Deterministic menuConfig navigation (worker/menu/handler).
 *   3.  Human-agent intent → notifyDashboard('human_requested', ...).
 *   4.  Meeting intent → resolveBookingUrl direct call (no HTTP).
 *   5.  Build OpenAI messages.
 *   6+7. Run OpenAI turn (with tool dispatch).
 *   8.  Safety nets — [BOOKING_LINK] substitution + manual-scheduling override.
 *   10. Re-prime menu navigation for the next turn (unless the LLM
 *       already ended with the 1/2 menu, in which case the digit-router
 *       above will catch it).
 */

import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import * as memory from '@/lib/messaging/memory';
import { getPendingMeeting } from '@/lib/meetings/queries';
import { notifyDashboard } from '@/lib/notifications/dashboard';
import { getPauseState, isPauseActive } from '@/lib/conversations/pauseState';
import { logAiTurn } from '@/lib/conversations/aiLog';
import { CONNECTING_TO_AGENT } from '@/lib/messaging/strings';
import { generateText, stepCountIs, type ModelMessage } from 'ai';
import { getModel, getModelId } from '@/lib/llm/provider';
import { botTools } from '@/lib/llm/tools';
import * as menu from '@/worker/menu/handler';
import { buildMessages } from './buildMessages';
import { resolveBookingUrl } from './resolveBookingUrl';
import { aiSchedulingManually, wantsEscalation, wantsMeeting } from './intent';

const OPENAI_TIMEOUT_MS = 30_000;
const TIMEOUT_FALLBACK_TEXT =
  "I'm taking too long to respond. Please try again in a moment.";

const logger = createLogger('orchestrator');

// ── Detection of the global next-step menu ────────────────────────────────
// Exact pair required (both 1 and 2 markers present) to avoid mis-triggering
// on a company's own numbered menus. Arabic translations matched too.
const NEXT_STEP_OPTION_1_MARKERS = [
  '1. book a meeting',
  '1. حجز موعد',
  '1. حجز اجتماع',
];
const NEXT_STEP_OPTION_2_MARKERS = [
  '2. chat with an agent',
  '2. التحدث مع وكيل',
  '2. التحدث إلى وكيل',
  '2. الدردشة مع وكيل',
];

function botJustOfferedNextStepMenu(history: { role: string; content: string }[]): boolean {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'assistant') {
      const content = (m.content ?? '').toLowerCase();
      const has1 = NEXT_STEP_OPTION_1_MARKERS.some((p) => content.includes(p));
      const has2 = NEXT_STEP_OPTION_2_MARKERS.some((p) => content.includes(p));
      return has1 && has2;
    }
  }
  return false;
}

function replyEndsWithNextStepMenu(reply: string | null): boolean {
  if (!reply) return false;
  const lower = reply.toLowerCase();
  const has1 = NEXT_STEP_OPTION_1_MARKERS.some((p) => lower.includes(p));
  const has2 = NEXT_STEP_OPTION_2_MARKERS.some((p) => lower.includes(p));
  return has1 && has2;
}

// Convert Arabic-Indic digits → Western, and lettered list markers (a./A) → digits.
const ARABIC_INDIC: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
};
// Exported for testing only — internal to the orchestrator otherwise.
export function normaliseMenuNumbers(text: string): string {
  let out = '';
  for (const ch of text) out += ARABIC_INDIC[ch] ?? ch;
  const lines = out.split('\n');
  let counter = 1;
  const result: string[] = [];
  for (let line of lines) {
    if (/^[A-Za-z][.)]\s/.test(line)) {
      line = line.replace(/^[A-Za-z]([.)]\s)/, `${counter}$1`);
      counter++;
    } else if (!/^\d+[.)]\s/.test(line)) {
      counter = 1;
    }
    result.push(line);
  }
  return result.join('\n');
}

// Exported for testing only — internal to the orchestrator otherwise.
export function isNextStepChoice(message: string): 1 | 2 | null {
  const stripped = normaliseMenuNumbers(message).trim();
  if (stripped === '1' || stripped === '1.' || stripped === '1)') return 1;
  if (stripped === '2' || stripped === '2.' || stripped === '2)') return 2;
  return null;
}

export interface GetReplyInput {
  customerPhone: string;
  newMessage: string;
  companyId: number;
  /** Default true. Audio worker passes false because it pre-saved the row with media metadata. */
  saveInbound?: boolean;
}

export type GetReplyResult = readonly [reply: string | null, meetingMessage: string | null];

export async function getReply(input: GetReplyInput): Promise<GetReplyResult> {
  const { customerPhone, newMessage, companyId } = input;
  const saveInbound = input.saveInbound ?? true;
  // Set when the existing human-handoff path fires this turn (escalation
  // intent, or next-step option 2). Used to tag the AI-exchange log.
  let handoffTriggered = false;

  // Step 1.
  const history = await memory.loadHistory(customerPhone, companyId);

  // Step 1a.
  if (saveInbound) {
    await memory.saveMessage({
      customerPhone,
      companyId,
      direction: 'inbound',
      messageText: newMessage,
    });
  }

  // Step 2.
  await notifyDashboard({
    event: 'message',
    customerPhone,
    messageText: newMessage,
    companyId,
  });

  // Pause gate. Save + notifyDashboard above ALWAYS run; everything below
  // (digit router, menu nav, intents, LLM) is suppressed while the agent
  // has the conversation paused. Auto-expire is read-time only — paused_at
  // older than PAUSE_TTL is treated as unpaused without touching the row.
  const pauseRow = await getPauseState(customerPhone, companyId);
  if (isPauseActive(pauseRow)) {
    logger.info({ phone: maskPhone(customerPhone) }, 'AI paused — suppressing auto-reply');
    return [null, null];
  }

  // Step 2a — deterministic 1/2 router.
  const choice = isNextStepChoice(newMessage);
  if (choice !== null && botJustOfferedNextStepMenu(history)) {
    if (choice === 1) {
      const pending = await getPendingMeeting(customerPhone, companyId);
      const bookingUrl = await resolveBookingUrl({
        customerPhone,
        companyId,
        pendingMeeting: pending,
      });
      if (bookingUrl) {
        logger.info(
          { phone: maskPhone(customerPhone) },
          'Next-step 1 → booking link sent',
        );
        const reply1 = `Here's your personal booking link — valid for 24 hours: ${bookingUrl}`;
        await logAiTurn({ companyId, customerPhone, userMessage: newMessage, response: reply1, status: 'complete' });
        return [reply1, null];
      }
      // Booking URL unavailable — fall through to LLM so it can apologise.
    } else {
      logger.info(
        { phone: maskPhone(customerPhone) },
        'Next-step 2 → human agent requested',
      );
      await notifyDashboard({
        event: 'human_requested',
        customerPhone,
        messageText: newMessage,
        companyId,
      });
      await logAiTurn({ companyId, customerPhone, userMessage: newMessage, response: CONNECTING_TO_AGENT, status: 'hand-off' });
      return [CONNECTING_TO_AGENT, null];
    }
  }

  // Step 2b — menu navigation.
  const convId = await memory.getConversationId(customerPhone, companyId);
  const [menuReply, leafSelection] = await menu.handle(
    customerPhone,
    companyId,
    newMessage,
    convId ?? '',
  );
  if (menuReply !== null) {
    logger.info({ phone: maskPhone(customerPhone) }, 'Menu level sent');
    await logAiTurn({ companyId, customerPhone, conversationId: convId, userMessage: newMessage, response: menuReply, status: 'in_progress' });
    return [menuReply, null];
  }

  // Step 3 — escalation.
  if (wantsEscalation(newMessage, history)) {
    logger.info({ phone: maskPhone(customerPhone) }, 'Human agent requested');
    handoffTriggered = true;
    await notifyDashboard({
      event: 'human_requested',
      customerPhone,
      messageText: newMessage,
      companyId,
    });
  }

  // Step 4 — meeting intent short-circuit.
  const pending = await getPendingMeeting(customerPhone, companyId);
  if (wantsMeeting(newMessage, history)) {
    const bookingUrl = await resolveBookingUrl({
      customerPhone,
      companyId,
      pendingMeeting: pending,
    });
    if (bookingUrl) {
      logger.info({ phone: maskPhone(customerPhone) }, 'Booking link sent');
      const reply = `Here's your personal booking link — valid for 24 hours: ${bookingUrl}`;
      await logAiTurn({ companyId, customerPhone, userMessage: newMessage, response: reply, status: handoffTriggered ? 'hand-off' : 'complete' });
      return [reply, null];
    }
  }

  // Step 5 — build OpenAI messages.
  const messages = await buildMessages({
    customerPhone,
    newMessage,
    history,
    pendingMeeting: pending,
    leafSelection,
    companyId,
  });

  // Step 6+7 — OpenAI call with tool dispatch (AI SDK generateText).
  // Tools are constructed per-request via the botTools(companyId) factory
  // so each tool's execute() captures companyId in closure — the model
  // never sees or controls company_id, preventing cross-tenant lookups.
  logger.info(
    {
      model: getModelId(),
      historyLen: history.length,
      phone: maskPhone(customerPhone),
    },
    'OpenAI request',
  );

  let finalReply: string | null;
  let usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null = null;
  try {
    const result = await generateText({
      model: getModel(),
      messages: messages as ModelMessage[],
      tools: botTools(companyId),
      // Match the legacy two-turn budget (tool call + follow-up). The
      // original runOpenAITurn ran one call, dispatched tools, then ran
      // one follow-up. stepCountIs(5) is conservative headroom.
      stopWhen: stepCountIs(5),
      abortSignal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
    });
    finalReply = result.text || null;
    usage = {
      promptTokens: result.usage?.inputTokens,
      completionTokens: result.usage?.outputTokens,
      totalTokens: result.usage?.totalTokens,
    };
  } catch (err) {
    const e = err as { name?: string; message?: string; code?: string };
    if (
      e.name === 'AbortError' ||
      e.name === 'TimeoutError' ||
      e.code === 'ETIMEDOUT' ||
      /timeout|aborted/i.test(e.message ?? '')
    ) {
      logger.error(
        { phone: maskPhone(customerPhone) },
        'OpenAI timeout',
      );
      await logAiTurn({ companyId, customerPhone, userMessage: newMessage, response: TIMEOUT_FALLBACK_TEXT, status: 'complete', model: getModelId() });
      return [TIMEOUT_FALLBACK_TEXT, null];
    }
    throw err;
  }

  // Step 8 — [BOOKING_LINK] substitution.
  if (finalReply && (finalReply.includes('[Booking Link]') || finalReply.includes('[BOOKING_LINK]'))) {
    logger.info(
      { phone: maskPhone(customerPhone) },
      'Replacing [BOOKING_LINK] placeholder',
    );
    const linkUrl = await resolveBookingUrl({
      customerPhone,
      companyId,
      pendingMeeting: pending,
    });
    if (linkUrl) {
      finalReply = finalReply
        .replaceAll('[Booking Link]', linkUrl)
        .replaceAll('[BOOKING_LINK]', linkUrl);
    }
  }

  // Step 8 — manual-scheduling override.
  if (finalReply && aiSchedulingManually(finalReply)) {
    logger.info(
      { phone: maskPhone(customerPhone) },
      'Overriding manual scheduling attempt',
    );
    const overrideUrl = await resolveBookingUrl({
      customerPhone,
      companyId,
      pendingMeeting: pending,
    });
    if (overrideUrl) {
      finalReply = `Here's your personal booking link — valid for 24 hours: ${overrideUrl}`;
    }
  }

  // Step 10 — re-prime menu navigation for next turn. Skip if the LLM
  // ended with the global 1/2 menu (so the digit-router catches the
  // reply instead of the company menuConfig).
  if (
    finalReply &&
    !replyEndsWithNextStepMenu(finalReply) &&
    /^\d+[.)]/m.test(finalReply)
  ) {
    const postConvId = await memory.getConversationId(customerPhone, companyId);
    if (postConvId) {
      await menu.start(customerPhone, companyId, postConvId);
    }
  }

  const normalisedReply = finalReply ? normaliseMenuNumbers(finalReply) : finalReply;
  // Tag from existing signals: hand-off if the human-handoff path fired this
  // turn; in_progress if the reply ends by offering the 1/2 next-step menu
  // (conversation continues); otherwise complete.
  const status = handoffTriggered
    ? 'hand-off'
    : replyEndsWithNextStepMenu(normalisedReply)
      ? 'in_progress'
      : 'complete';
  await logAiTurn({
    companyId,
    customerPhone,
    userMessage: newMessage,
    response: normalisedReply,
    status,
    model: getModelId(),
    usage,
  });

  return [normalisedReply, null];
}
