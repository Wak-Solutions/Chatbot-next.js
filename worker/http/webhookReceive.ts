/**
 * Meta inbound-message webhook — Fastify route handler shape.
 *
 * Replaces the bare node:http version. Behaviour is identical — only the
 * handler signature and raw-body access change:
 *
 *   Before: readRawBody(req: IncomingMessage) → Buffer  (manual stream concat)
 *   After:  req.rawBody as Buffer              (fastify-raw-body plugin,
 *            registered with encoding:false in server.ts, opted-in via
 *            config: { rawBody: true } on the POST /webhook route)
 *
 * Original port of Chatbot/routes/webhook.py:49.
 *
 * Contract surface (Phase 1 §10):
 *
 *   - Per-company HMAC-SHA256 signature verification using the
 *     companies.whatsapp_app_secret column, keyed by phone_number_id
 *     extracted from the body BEFORE the body is parsed for processing.
 *
 *   - 403 ONLY on positive signature failure (missing header, secret
 *     unset for the phone_number_id, hash mismatch).
 *
 *   - 200 on every recoverable input issue (malformed JSON, missing
 *     phone_number_id, unknown phone_number_id, DB error during
 *     company lookup, unsupported message type, audio without media_id).
 *     Anti-flood: any non-200 response makes Meta retry the same
 *     webhook repeatedly. The customer retries via WhatsApp — Meta
 *     does not need to.
 *
 *   - Message-id idempotency via lib/inbox/messageIdClaim (PR 7).
 *     Duplicate deliveries no-op and return 200.
 *
 *   - Verified raw payload persisted to raw_inbound_messages for crash-
 *     replay (best-effort; failure is logged and ignored).
 *
 *   - Dispatch to worker/tasks/processText or processAudio runs inside
 *     the worker/concurrency Semaphore (max 8). 200 is returned to Meta
 *     IMMEDIATELY after enqueue — the actual bot turn runs in the
 *     background so Meta's webhook timeout is never hit.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import 'fastify-raw-body';
import type { Logger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { verifyMetaSignature } from '@/lib/messaging/whatsapp';
import {
  lookupAppSecretByPhoneNumberId,
  getWhatsappCreds,
} from '@/lib/companies/creds';
import { resolveCompanyByPhoneNumberId } from '@/lib/companies/resolveByPhoneNumberId';
import { claimMessageId } from '@/lib/inbox/messageIdClaim';
import { getPool } from '@/lib/db/client';
import { botQueue } from '@/lib/queue/queues';
import type { ProcessTextInput } from '@/worker/tasks/processText';
import type { ProcessAudioInput } from '@/worker/tasks/processAudio';

async function persistRawInbound(
  phoneNumberId: string,
  payload: unknown,
  logger: Logger,
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO raw_inbound_messages (phone_number_id, payload)
       VALUES ($1, $2::jsonb)`,
      [phoneNumberId, JSON.stringify(payload)],
    );
  } catch (err) {
    logger.error(
      { phoneNumberId, err: (err as Error)?.message },
      'persistRawInbound failed (non-fatal)',
    );
  }
}

export function makeWebhookReceiveHandler(logger: Logger) {
  return async function handleReceive(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // fastify-raw-body sets rawBody when config.rawBody: true on the route.
    // The import 'fastify-raw-body' above augments FastifyRequest with rawBody.
    const rawBody = req.rawBody as Buffer;

    const signatureHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!signature) {
      logger.warn('Webhook POST rejected — missing X-Hub-Signature-256 header');
      await reply.status(403).send({ error: 'Forbidden' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prelim: any;
    try {
      prelim = JSON.parse(rawBody.toString('utf8'));
    } catch {
      logger.warn('Webhook POST dropped — malformed JSON body');
      await reply.send({ status: 'ok' });
      return;
    }

    const entry = prelim?.entry ?? [];
    const changes = entry[0]?.changes ?? [];
    const value = changes[0]?.value ?? {};
    const phoneNumberId: string = value?.metadata?.phone_number_id ?? '';

    if (!phoneNumberId) {
      logger.info('Webhook with no phone_number_id — likely a status update, accepting');
      await reply.send({ status: 'ok' });
      return;
    }

    let appSecret: string | null;
    try {
      appSecret = await lookupAppSecretByPhoneNumberId(phoneNumberId);
    } catch (err) {
      logger.error(
        { phoneNumberId, err: (err as Error)?.message },
        'Webhook POST dropped — DB lookup failed for phone_number_id',
      );
      await reply.send({ status: 'ok' });
      return;
    }
    if (!appSecret) {
      logger.warn(
        { phoneNumberId },
        'Webhook POST rejected — no app_secret registered for phone_number_id',
      );
      await reply.status(403).send({ error: 'Forbidden' });
      return;
    }

    if (!verifyMetaSignature(rawBody, signature, appSecret)) {
      logger.warn({ phoneNumberId }, 'Webhook POST rejected — signature mismatch');
      await reply.status(403).send({ error: 'Forbidden' });
      return;
    }

    await persistRawInbound(phoneNumberId, prelim, logger);

    let companyId: number | null;
    try {
      companyId = await resolveCompanyByPhoneNumberId(phoneNumberId);
    } catch (err) {
      logger.error(
        { phoneNumberId, err: (err as Error)?.message },
        'Webhook POST — DB lookup failed for company',
      );
      await reply.send({ status: 'ok' });
      return;
    }
    if (companyId === null) {
      await reply.send({ status: 'unroutable' });
      return;
    }

    const creds = await getWhatsappCreds(companyId);
    if (!creds) {
      logger.error({ companyId }, 'Company has no WhatsApp credentials — cannot reply');
      await reply.send({ status: 'no_creds' });
      return;
    }

    const messagesList = value?.messages ?? [];
    if (messagesList.length === 0) {
      logger.info('No messages in payload — likely a status update, ignoring');
      await reply.send({ status: 'ok' });
      return;
    }

    const message = messagesList[0];
    const msgType = message?.type as string | undefined;
    const customerPhone = message?.from as string | undefined;
    const messageId = message?.id as string | undefined;

    if (!customerPhone) {
      logger.warn("Webhook message missing 'from' field — ignoring");
      await reply.send({ status: 'ok' });
      return;
    }

    if (messageId) {
      const claimed = await claimMessageId(messageId);
      if (!claimed) {
        logger.info({ messageId }, 'Duplicate webhook delivery — skipping');
        await reply.send({ status: 'ok' });
        return;
      }
    }

    if (msgType === 'text') {
      const messageText = message?.text?.body as string | undefined;
      if (!messageText) {
        logger.warn({ phone: maskPhone(customerPhone) }, 'Text message with empty body');
        await reply.send({ status: 'ok' });
        return;
      }
      logger.info(
        { phone: maskPhone(customerPhone), companyId, type: 'text' },
        'Message received',
      );
      try {
        const data: ProcessTextInput = {
          customerPhone,
          messageText,
          companyId: companyId as number,
          creds: { token: creds.token, phoneId: creds.phoneId },
        };
        await botQueue.add('process-text', data);
      } catch (err) {
        logger.error(
          { phone: maskPhone(customerPhone), err: (err as Error).message },
          'process-text enqueue failed',
        );
      }
      await reply.send({ status: 'ok' });
      return;
    }

    if (msgType === 'audio') {
      const audioData = message?.audio ?? {};
      const mediaId = audioData?.id as string | undefined;
      const mime = (audioData?.mime_type as string | undefined) ?? 'audio/ogg';
      if (!mediaId) {
        logger.warn({ phone: maskPhone(customerPhone) }, 'Audio message missing media ID');
        await reply.send({ status: 'ok' });
        return;
      }
      logger.info(
        { phone: maskPhone(customerPhone), companyId, type: 'audio', mime },
        'Message received',
      );
      try {
        const data: ProcessAudioInput = {
          customerPhone,
          mediaId,
          mimeType: mime,
          companyId: companyId as number,
          creds: { token: creds.token, phoneId: creds.phoneId },
        };
        await botQueue.add('process-audio', data);
      } catch (err) {
        logger.error(
          { phone: maskPhone(customerPhone), err: (err as Error).message },
          'process-audio enqueue failed',
        );
      }
      await reply.send({ status: 'ok' });
      return;
    }

    logger.info({ phone: maskPhone(customerPhone), type: msgType }, 'Unsupported message type');
    await reply.send({ status: 'ok' });
  };
}
