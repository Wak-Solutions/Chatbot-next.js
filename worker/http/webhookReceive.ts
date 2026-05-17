/**
 * Meta inbound-message webhook — port of Chatbot/routes/webhook.py:49.
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

import type { IncomingMessage, ServerResponse } from 'node:http';
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
import type { Semaphore } from '@/worker/concurrency';
import { processText } from '@/worker/tasks/processText';
import { processAudio } from '@/worker/tasks/processAudio';

function send200(res: ServerResponse, body: object = { status: 'ok' }): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function send403(res: ServerResponse, body: object = { error: 'Forbidden' }): void {
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

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

export function makeWebhookReceiveHandler(logger: Logger, sema: Semaphore) {
  return async function handleReceive(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // ── Read raw body once — needed for signature verification ──────────
    const rawBody = await readRawBody(req);

    const signatureHeader = req.headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    if (!signature) {
      logger.warn('Webhook POST rejected — missing X-Hub-Signature-256 header');
      return send403(res);
    }

    // Parse preliminarily to extract phone_number_id (signature target).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prelim: any;
    try {
      prelim = JSON.parse(rawBody.toString('utf8'));
    } catch {
      // Anti-flood: malformed JSON → 200 OK (no processing, no Meta retry storm).
      logger.warn('Webhook POST dropped — malformed JSON body');
      return send200(res);
    }

    const entry = prelim?.entry ?? [];
    const changes = entry[0]?.changes ?? [];
    const value = changes[0]?.value ?? {};
    const phoneNumberId: string = value?.metadata?.phone_number_id ?? '';

    if (!phoneNumberId) {
      // Status-update callbacks without messages — accept silently.
      logger.info('Webhook with no phone_number_id — likely a status update, accepting');
      return send200(res);
    }

    // ── Resolve app_secret for this phone_number_id ─────────────────────
    let appSecret: string | null;
    try {
      appSecret = await lookupAppSecretByPhoneNumberId(phoneNumberId);
    } catch (err) {
      // Anti-flood (FINAL-024): DB error → 200 so Meta doesn't retry the
      // same webhook in a storm. The customer can retry via WhatsApp.
      logger.error(
        { phoneNumberId, err: (err as Error)?.message },
        'Webhook POST dropped — DB lookup failed for phone_number_id',
      );
      return send200(res);
    }
    if (!appSecret) {
      // FAIL-CLOSED (FINAL-033): missing app_secret → 403. No fallback to
      // an empty string or shared default.
      logger.warn(
        { phoneNumberId },
        'Webhook POST rejected — no app_secret registered for phone_number_id',
      );
      return send403(res);
    }

    // ── HMAC verify ─────────────────────────────────────────────────────
    if (!verifyMetaSignature(rawBody, signature, appSecret)) {
      logger.warn(
        { phoneNumberId },
        'Webhook POST rejected — signature mismatch',
      );
      return send403(res);
    }

    // ── Verified — persist raw payload (best-effort) ────────────────────
    await persistRawInbound(phoneNumberId, prelim, logger);

    // ── Resolve company + creds ─────────────────────────────────────────
    let companyId: number | null;
    try {
      companyId = await resolveCompanyByPhoneNumberId(phoneNumberId);
    } catch (err) {
      logger.error(
        { phoneNumberId, err: (err as Error)?.message },
        'Webhook POST — DB lookup failed for company',
      );
      return send200(res);
    }
    if (companyId === null) {
      return send200(res, { status: 'unroutable' });
    }

    const creds = await getWhatsappCreds(companyId);
    if (!creds) {
      logger.error({ companyId }, 'Company has no WhatsApp credentials — cannot reply');
      return send200(res, { status: 'no_creds' });
    }

    // ── Extract message ─────────────────────────────────────────────────
    const messagesList = value?.messages ?? [];
    if (messagesList.length === 0) {
      logger.info('No messages in payload — likely a status update, ignoring');
      return send200(res);
    }

    const message = messagesList[0];
    const msgType = message?.type as string | undefined;
    const customerPhone = message?.from as string | undefined;
    const messageId = message?.id as string | undefined;

    if (!customerPhone) {
      logger.warn("Webhook message missing 'from' field — ignoring");
      return send200(res);
    }

    // ── Idempotency ─────────────────────────────────────────────────────
    if (messageId) {
      const claimed = await claimMessageId(messageId);
      if (!claimed) {
        logger.info({ messageId }, 'Duplicate webhook delivery — skipping');
        return send200(res);
      }
    }

    // ── Dispatch (concurrency-capped, fire-and-forget) ──────────────────
    if (msgType === 'text') {
      const messageText = message?.text?.body as string | undefined;
      if (!messageText) {
        logger.warn(
          { phone: maskPhone(customerPhone) },
          'Text message with empty body',
        );
        return send200(res);
      }
      logger.info(
        { phone: maskPhone(customerPhone), companyId, type: 'text' },
        'Message received',
      );
      sema
        .acquire()
        .then(async (release) => {
          try {
            await processText({
              customerPhone,
              messageText,
              companyId: companyId as number,
              creds: { token: creds.token, phoneId: creds.phoneId },
            });
          } finally {
            release();
          }
        })
        .catch((err: Error) =>
          logger.error(
            { phone: maskPhone(customerPhone), err: err.message },
            'processText dispatch failed',
          ),
        );
      return send200(res);
    }

    if (msgType === 'audio') {
      const audioData = message?.audio ?? {};
      const mediaId = audioData?.id as string | undefined;
      const mime = (audioData?.mime_type as string | undefined) ?? 'audio/ogg';
      if (!mediaId) {
        logger.warn(
          { phone: maskPhone(customerPhone) },
          'Audio message missing media ID',
        );
        return send200(res);
      }
      logger.info(
        { phone: maskPhone(customerPhone), companyId, type: 'audio', mime },
        'Message received',
      );
      sema
        .acquire()
        .then(async (release) => {
          try {
            await processAudio({
              customerPhone,
              mediaId,
              mimeType: mime,
              companyId: companyId as number,
              creds: { token: creds.token, phoneId: creds.phoneId },
            });
          } finally {
            release();
          }
        })
        .catch((err: Error) =>
          logger.error(
            { phone: maskPhone(customerPhone), err: err.message },
            'processAudio dispatch failed',
          ),
        );
      return send200(res);
    }

    logger.info(
      { phone: maskPhone(customerPhone), type: msgType },
      'Unsupported message type',
    );
    return send200(res);
  };
}
