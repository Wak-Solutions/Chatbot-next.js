/**
 * Build the OpenAI messages array for one bot turn.
 *
 * Port of Chatbot/_agent_messages.py. Shape:
 *
 *   [
 *     { role: 'system', content: <prompt + menu nav override + booking URL hint> },
 *     ...history,
 *     { role: 'user', content: <new_message OR leaf-selection rewrite> },
 *     { role: 'system', content: <final language enforcement> },
 *   ]
 *
 * - The system prompt comes from @/lib/llm/prompts/cache (60s TTL,
 *   invalidated by dashboard saves).
 * - The MENU NAVIGATION RULE suffix tells the model to display ONLY the
 *   top-level menu — sub-levels are handled deterministically by
 *   worker/menu/handler.
 * - The BOOKING URL block either injects a real pending-meeting URL
 *   (so the model can include it verbatim) or instructs the model to
 *   emit a [BOOKING_LINK] placeholder we substitute downstream.
 * - The leaf_selection rewrite replaces the bare digit a customer sent
 *   to reach a leaf with a "I'd like to enquire about: <breadcrumb>"
 *   sentence so the model has semantic context.
 * - The trailing FINAL INSTRUCTION re-asserts the customer's CURRENT
 *   message language so a long history in another language doesn't
 *   flip the reply.
 */

import { getSystemPrompt } from '@/lib/llm/prompts/cache';
import { detectLanguage } from '@/lib/llm/prompts/language';
import { formatTopLevel } from '@/worker/menu/handler';
import type { HistoryMessage } from '@/lib/messaging/memory';
import type { PendingMeeting } from '@/lib/meetings/queries';

export interface BuildMessagesInput {
  customerPhone: string;
  newMessage: string;
  history: HistoryMessage[];
  pendingMeeting: PendingMeeting | null;
  leafSelection: string | null;
  companyId: number;
}

export type OpenAIMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | Record<string, unknown>;

export async function buildMessages(
  input: BuildMessagesInput,
): Promise<OpenAIMessage[]> {
  const { newMessage, history, pendingMeeting, leafSelection, companyId } = input;

  let systemContent = await getSystemPrompt(companyId, newMessage);

  // Append menu-nav override.
  const topMenu = await formatTopLevel(companyId);
  if (topMenu) {
    systemContent +=
      '\n\nMENU NAVIGATION RULE (overrides the MAIN MENU section above):\n' +
      'When presenting the service menu, display ONLY the top-level options ' +
      'listed below — NEVER show sub-items. The customer selects by number and ' +
      'the sub-options are delivered automatically.\n' +
      topMenu +
      '\nWait for the customer to reply with a number before going deeper.';
  }

  // Booking URL injection.
  const dashboardUrl = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '');
  const injectedBookingUrl =
    pendingMeeting && !pendingMeeting.scheduled_at && pendingMeeting.meeting_token && dashboardUrl
      ? `${dashboardUrl}/book/${pendingMeeting.meeting_token}`
      : null;

  if (injectedBookingUrl) {
    systemContent +=
      `\n\nBOOKING URL: ${injectedBookingUrl}\n` +
      'When sending the customer a meeting/booking link, use this exact URL. ' +
      'Do NOT invent, shorten, or modify it.';
  } else {
    systemContent +=
      '\n\nWhen sending the customer a meeting/booking link, output the literal ' +
      'text [BOOKING_LINK] as a placeholder — it will be replaced automatically. ' +
      'Do NOT invent a URL.';
  }

  const effectiveMessage = leafSelection
    ? `I'd like to enquire about: ${leafSelection}`
    : newMessage;

  const lang = detectLanguage(newMessage);
  const finalInstruction =
    `FINAL INSTRUCTION: The customer just wrote in ${lang}. ` +
    `Your response MUST be in ${lang} only. ` +
    'Do not use any other language under any circumstances.';

  return [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: effectiveMessage },
    { role: 'system', content: finalInstruction },
  ];
}
