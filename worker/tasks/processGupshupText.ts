/**
 * Gupshup text-message background task — fully self-contained (Gupshup only).
 *
 * The Gupshup analogue of worker/tasks/processText.ts (Meta). Kept entirely
 * separate so the live Meta path (processText) is never touched. Same
 * pipeline shape:
 *   1. getReply (orchestrator) — the shared brain.
 *   2. claimOutbound(jobId) — idempotency guard, skip duplicate sends.
 *   3. send via Gupshup (lib/messaging/gupshup.sendGupshupText).
 *   4. persist outbound row (lib/messaging/memory.saveMessage).
 *   5. send follow-up meeting message if any.
 *   6. fallback apology on unexpected failure — skipped if the real reply
 *      already reached the customer.
 *
 * jobId defaults to '' so the function is safe to call outside a BullMQ
 * context (e.g. tests) — the guard becomes a no-op when empty.
 */

import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { saveMessage } from '@/lib/messaging/memory';
import { claimOutbound } from '@/lib/messaging/outboundGuard';
import { sendGupshupText, type GupshupSendCreds } from '@/lib/messaging/gupshup';
import { getReply } from '@/worker/orchestrator/getReply';

const logger = createLogger('process-gupshup-text');

export interface ProcessGupshupTextInput {
  customerPhone: string;
  messageText: string;
  companyId: number;
  creds: GupshupSendCreds;
}

export async function processGupshupText(input: ProcessGupshupTextInput, jobId = ''): Promise<void> {
  const { customerPhone, messageText, companyId, creds } = input;
  let realReplySent = false;

  try {
    logger.info({ phone: maskPhone(customerPhone) }, 'Processing Gupshup text message');

    const [reply, meetingMessage] = await getReply({
      customerPhone,
      newMessage: messageText,
      companyId,
    });

    if (reply) {
      const safe = await claimOutbound(jobId);
      if (safe) {
        await sendGupshupText({ phone: customerPhone, body: reply, ...creds });
      } else {
        logger.info({ phone: maskPhone(customerPhone) }, 'Outbound already sent — skipping duplicate send');
      }
      realReplySent = true;
      await saveMessage({
        customerPhone,
        companyId,
        direction: 'outbound',
        messageText: reply,
        sender: 'ai',
      });
      logger.info({ phone: maskPhone(customerPhone) }, 'Reply sent — type: text (gupshup)');
    }

    if (meetingMessage) {
      const safeMeeting = await claimOutbound(jobId ? `${jobId}:meeting` : '');
      if (safeMeeting) {
        await sendGupshupText({ phone: customerPhone, body: meetingMessage, ...creds });
      } else {
        logger.info({ phone: maskPhone(customerPhone) }, 'Meeting invite already sent — skipping duplicate send');
      }
      await saveMessage({
        customerPhone,
        companyId,
        direction: 'outbound',
        messageText: meetingMessage,
        sender: 'ai',
      });
      logger.info({ phone: maskPhone(customerPhone) }, 'Meeting invitation sent (gupshup)');
    }
  } catch (err) {
    logger.error(
      { phone: maskPhone(customerPhone), err: (err as Error)?.message },
      'Failed to process Gupshup text message',
    );
    if (realReplySent) return;
    try {
      await sendGupshupText({
        phone: customerPhone,
        body:
          'Sorry, something went wrong on our side. ' +
          'Please try sending your message again in a moment.',
        ...creds,
      });
    } catch (fallbackErr) {
      logger.error(
        { phone: maskPhone(customerPhone), err: (fallbackErr as Error)?.message },
        'Fallback message send failed',
      );
    }
  }
}
