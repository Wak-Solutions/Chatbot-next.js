/**
 * Text-message background task — port of Chatbot/workers/text.py.
 *
 * Pipeline:
 *   1. getReply (orchestrator). Returns a single reply string and an
 *      optional follow-up meeting message (always null today).
 *   2. send via Meta (lib/messaging/whatsapp.sendWhatsAppTextWithCreds).
 *   3. persist outbound row (lib/messaging/memory.saveMessage).
 *   4. send follow-up meeting message if any.
 *   5. fallback apology on unexpected failure — skipped if the real
 *      reply already reached the customer (avoids duplicate apology).
 */

import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { sendWhatsAppTextWithCreds } from '@/lib/messaging/whatsapp';
import { saveMessage } from '@/lib/messaging/memory';
import { getReply } from '@/worker/orchestrator/getReply';

const logger = createLogger('process-text');

export interface ProcessTextInput {
  customerPhone: string;
  messageText: string;
  companyId: number;
  creds: { token: string; phoneId: string };
}

export async function processText(input: ProcessTextInput): Promise<void> {
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
      await sendWhatsAppTextWithCreds({ phone: customerPhone, body: reply, creds });
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
      await sendWhatsAppTextWithCreds({ phone: customerPhone, body: meetingMessage, creds });
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
