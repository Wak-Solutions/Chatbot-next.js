/**
 * Gupshup voice-note background task — fully self-contained (Gupshup only).
 *
 * The Gupshup analogue of worker/tasks/processAudio.ts (Meta), kept entirely
 * separate so the live Meta path is never touched. Gupshup delivers audio as
 * a direct media URL — not a Meta media_id — so this transcribes the URL
 * (lib/messaging/voice.transcribeAudioUrl) instead of doing the Meta CDN
 * resolve-then-download dance.
 *
 * Downstream reuses the shared brain — getReply (saveInbound:false; the
 * inbound row is saved here with the transcription) + claimOutbound
 * idempotency — and sends via Gupshup directly (sendGupshupText).
 */

import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { transcribeAudioUrl } from '@/lib/messaging/voice';
import { saveMessage } from '@/lib/messaging/memory';
import { claimOutbound } from '@/lib/messaging/outboundGuard';
import { sendGupshupText, type GupshupSendCreds } from '@/lib/messaging/gupshup';
import { getReply } from '@/worker/orchestrator/getReply';

const logger = createLogger('process-gupshup-audio');

const APOLOGY_GENERIC =
  "Sorry, I couldn't process your voice message. Could you type your question instead?";

export interface ProcessGupshupAudioInput {
  customerPhone: string;
  mediaUrl: string;
  companyId: number;
  creds: GupshupSendCreds;
}

export async function processGupshupAudio(
  input: ProcessGupshupAudioInput,
  jobId = '',
): Promise<void> {
  const { customerPhone, mediaUrl, companyId, creds } = input;

  try {
    logger.info({ phone: maskPhone(customerPhone) }, 'Processing Gupshup voice note');

    const transcription = await transcribeAudioUrl(mediaUrl);
    if (!transcription) {
      logger.warn({ phone: maskPhone(customerPhone) }, 'Gupshup voice note could not be transcribed');
      await saveMessage({
        customerPhone,
        companyId,
        direction: 'inbound',
        messageText: '[Voice message — transcription unavailable]',
        sender: 'customer',
        mediaType: 'audio',
        mediaUrl,
        transcription: null,
      });
      await sendGupshupText({ phone: customerPhone, body: APOLOGY_GENERIC, ...creds });
      return;
    }

    // Save inbound with the transcription; getReply must NOT re-save it.
    await saveMessage({
      customerPhone,
      companyId,
      direction: 'inbound',
      messageText: transcription,
      sender: 'customer',
      mediaType: 'audio',
      mediaUrl,
      transcription,
    });

    const [reply, meetingMessage] = await getReply({
      customerPhone,
      newMessage: transcription,
      companyId,
      saveInbound: false,
    });

    if (reply) {
      const safe = await claimOutbound(jobId);
      if (safe) {
        await sendGupshupText({ phone: customerPhone, body: reply, ...creds });
      } else {
        logger.info({ phone: maskPhone(customerPhone) }, 'Outbound already sent — skipping duplicate send');
      }
      await saveMessage({
        customerPhone,
        companyId,
        direction: 'outbound',
        messageText: reply,
        sender: 'ai',
      });
      logger.info({ phone: maskPhone(customerPhone) }, 'Reply sent after Gupshup voice note — type: text');
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
    }
  } catch (err) {
    logger.error(
      { phone: maskPhone(customerPhone), err: (err as Error)?.message },
      'Failed to process Gupshup voice note',
    );
  }
}
