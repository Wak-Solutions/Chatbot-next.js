/**
 * Audio-message (WhatsApp voice note) background task — port of
 * Chatbot/workers/audio.py.
 *
 * Pipeline:
 *   1. Download audio from Meta CDN (lib/messaging/voice.downloadMediaFromMeta).
 *   2. Store BYTEA in voice_notes (lib/messaging/voice.storeVoiceNote).
 *   3. Whisper transcribe (lib/messaging/voice.transcribeWithWhisper).
 *   4. Save inbound row WITH media metadata (saveInbound flag below
 *      tells the text orchestrator not to re-save).
 *   5. Run transcription through the normal text orchestrator
 *      (getReply with saveInbound: false).
 *   6. claimOutbound(jobId) — skip send if a previous attempt already
 *      delivered this reply (idempotency guard, lib/messaging/outboundGuard).
 *
 * Each failure mode (too-large, download error, transcription failure,
 * empty transcription) sends a customer-friendly apology so the
 * customer is never left in silence.
 *
 * jobId defaults to '' so the function is safe to call outside a BullMQ
 * context — the guard becomes a no-op when empty.
 */

import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import {
  downloadMediaFromMeta,
  storeVoiceNote,
  transcribeWithWhisper,
  VoiceDownloadError,
} from '@/lib/messaging/voice';
import { saveMessage } from '@/lib/messaging/memory';
import { sendWhatsAppTextWithCreds } from '@/lib/messaging/whatsapp';
import { claimOutbound } from '@/lib/messaging/outboundGuard';
import { getCompanyAppUrl } from '@/lib/companies/appUrl';
import { getReply } from '@/worker/orchestrator/getReply';

const logger = createLogger('process-audio');

export interface ProcessAudioInput {
  customerPhone: string;
  mediaId: string;
  mimeType: string;
  companyId: number;
  creds: { token: string; phoneId: string };
}

const APOLOGY_GENERIC =
  "Sorry, I couldn't process your voice message. Could you type your question instead?";
const APOLOGY_TOO_LARGE =
  'Sorry, your voice message is too long for me to process. Could you send a shorter message (under 3 minutes) or type your question instead?';
const APOLOGY_NO_SPEECH =
  "I received your voice message but couldn't make out any words. Could you type your question instead?";

export async function processAudio(input: ProcessAudioInput, jobId = ''): Promise<void> {
  const { customerPhone, mediaId, mimeType, companyId, creds } = input;

  try {
    logger.info(
      { phone: maskPhone(customerPhone), mime: mimeType },
      'Processing voice note',
    );

    // Step 1 — Download.
    let bytes: Buffer;
    let actualMime: string;
    try {
      const result = await downloadMediaFromMeta(mediaId, creds.token);
      bytes = result.bytes;
      actualMime = result.mimeType;
    } catch (err) {
      const tooLarge =
        err instanceof VoiceDownloadError && err.kind === 'too_large';
      logger.error(
        {
          phone: maskPhone(customerPhone),
          err: (err as Error)?.message,
          tooLarge,
        },
        'Voice note download failed',
      );
      await sendWhatsAppTextWithCreds({
        phone: customerPhone,
        body: tooLarge ? APOLOGY_TOO_LARGE : APOLOGY_GENERIC,
        creds,
      });
      return;
    }

    // Step 2 — Store.
    const audioId = await storeVoiceNote(bytes, actualMime, companyId);
    const appUrl = await getCompanyAppUrl(companyId);
    if (!appUrl) {
      logger.error(
        { companyId },
        'Audio handling — app_url not set, cannot build media_url',
      );
      return;
    }
    const mediaUrl = `${appUrl}/api/voice-notes/${audioId}`;

    // Step 3 — Transcribe.
    let transcription: string;
    try {
      transcription = await transcribeWithWhisper(bytes, actualMime);
    } catch (err) {
      logger.error(
        { phone: maskPhone(customerPhone), err: (err as Error)?.message },
        'Whisper transcription failed',
      );
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
      await sendWhatsAppTextWithCreds({
        phone: customerPhone,
        body: APOLOGY_GENERIC,
        creds,
      });
      return;
    }

    if (!transcription) {
      logger.info(
        { phone: maskPhone(customerPhone) },
        'Whisper returned empty transcription',
      );
      await saveMessage({
        customerPhone,
        companyId,
        direction: 'inbound',
        messageText: '[Voice message — no speech detected]',
        sender: 'customer',
        mediaType: 'audio',
        mediaUrl,
        transcription: '',
      });
      await sendWhatsAppTextWithCreds({
        phone: customerPhone,
        body: APOLOGY_NO_SPEECH,
        creds,
      });
      return;
    }

    // Step 4 — Save inbound with full media metadata.
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

    // Step 5 — Run transcription through normal text flow.
    const [reply, meetingMessage] = await getReply({
      customerPhone,
      newMessage: transcription,
      companyId,
      saveInbound: false,
    });

    if (reply) {
      // Step 6 — Idempotency guard before send.
      const safe = await claimOutbound(jobId);
      if (safe) {
        await sendWhatsAppTextWithCreds({ phone: customerPhone, body: reply, creds });
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
      logger.info(
        { phone: maskPhone(customerPhone) },
        'Reply sent after voice note — type: text',
      );
    }

    if (meetingMessage) {
      // Distinct key prevents a main-reply retry from suppressing the invite,
      // and a meeting-invite retry from duplicating it.
      const safeMeeting = await claimOutbound(jobId ? `${jobId}:meeting` : '');
      if (safeMeeting) {
        await sendWhatsAppTextWithCreds({
          phone: customerPhone,
          body: meetingMessage,
          creds,
        });
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
      'Failed to process voice note',
    );
  }
}
