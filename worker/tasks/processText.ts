/**
 * Text-message background task — port of Chatbot/workers/text.py.
 *
 * Pipeline:
 *   1. getReply (orchestrator). Returns a single reply string and an
 *      optional follow-up meeting message (always null today).
 *   2. claimOutbound(jobId) — skip send if a previous attempt already
 *      delivered this reply (idempotency guard, lib/messaging/outboundGuard).
 *   3. send via Meta (lib/messaging/whatsapp.sendWhatsAppTextWithCreds).
 *   4. persist outbound row (lib/messaging/memory.saveMessage).
 *   5. send follow-up meeting message if any.
 *   6. fallback apology on unexpected failure — skipped if the real
 *      reply already reached the customer (avoids duplicate apology).
 *
 * jobId defaults to '' so the function is safe to call outside a BullMQ
 * context (e.g. tests) — the guard becomes a no-op when empty.
 */

import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { sendWhatsAppTextWithCreds } from '@/lib/messaging/whatsapp';
import { saveMessage } from '@/lib/messaging/memory';
import { claimOutbound } from '@/lib/messaging/outboundGuard';
import { getReply } from '@/worker/orchestrator/getReply';

const logger = createLogger('process-text');

export interface ProcessTextInput {
  customerPhone: string;
  messageText: string;
  companyId: number;
  creds: { token: string; phoneId: string };
}

export async function processText(input: ProcessTextInput, jobId = ''): Promise<void> {
  const { customerPhone, messageText, companyId, creds } = input;
  let realReplySent = false;

  try {
    logger.info({ phone: maskPhone(customerPhone) }, 'Processing text message');

    const [reply, meetingMessage] = await getReply({
      customerPhone,
      newMessage: messageText,
      companyId,
    });

    if (reply) {
      const safe = await claimOutbound(jobId);
      if (safe) {
        await sendWhatsAppTextWithCreds({ phone: customerPhone, body: reply, creds });
      } else {
        logger.info({ phone: maskPhone(customerPhone) }, 'Outbound already sent — skipping duplicate send');
      }
      // Mark as sent regardless — prevents fallback apology on retries.
      realReplySent = true;
      await saveMessage({
        customerPhone,
        companyId,
        direction: 'outbound',
        messageText: reply,
        sender: 'ai',
      });
      logger.info({ phone: maskPhone(customerPhone) }, 'Reply sent — type: text');
    }

    if (meetingMessage) {
      // Guard with a distinct key so a main-reply retry doesn't suppress the
      // meeting invite, and a meeting-invite retry doesn't duplicate it.
      const safeMeeting = await claimOutbound(jobId ? `${jobId}:meeting` : '');
      if (safeMeeting) {
        await sendWhatsAppTextWithCreds({ phone: customerPhone, body: meetingMessage, creds });
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
      logger.info({ phone: maskPhone(customerPhone) }, 'Meeting invitation sent');
    }
  } catch (err) {
    logger.error(
      { phone: maskPhone(customerPhone), err: (err as Error)?.message },
      'Failed to process text message',
    );
    if (realReplySent) return;
    try {
      await sendWhatsAppTextWithCreds({
        phone: customerPhone,
        body:
          'Sorry, something went wrong on our side. ' +
          'Please try sending your message again in a moment.',
        creds,
      });
    } catch (fallbackErr) {
      logger.error(
        { phone: maskPhone(customerPhone), err: (fallbackErr as Error)?.message },
        'Fallback message send failed',
      );
    }
  }
}
