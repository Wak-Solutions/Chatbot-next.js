/**
 * Gupshup inbound-message webhook — Fastify route handler.
 *
 * The Gupshup analogue of worker/http/webhookReceive.ts (Meta). Same async
 * contract — ack fast, do the bot turn in the background — but Gupshup's
 * wire format differs from Meta's:
 *
 *   - No HMAC signature. Gupshup does not sign payloads the way Meta does
 *     (x-hub-signature-256). Auth is an operator-configured value: we
 *     compare an `apikey` header against GUPSHUP_WEBHOOK_TOKEN (constant
 *     time). If the env var is unset we accept but warn — bring-up only;
 *     in production set the token AND IP-allowlist Gupshup per their docs.
 *
 *   - Tenant key is the `app` name (companies.gupshup_app_name), not a
 *     phone_number_id.
 *
 *   - Envelope: { app, timestamp, version, type, payload:{ id, source,
 *     type, payload:{...}, sender } }. We act only on type === 'message';
 *     'message-event' (delivery/read) and 'user-event' (sandbox-start)
 *     are acked and ignored.
 *
 *   - Audio arrives as a direct media URL (payload.payload.url), not a
 *     Meta media_id — so the audio path transcribes the URL rather than
 *     downloading from the Meta CDN.
 *
 * Idempotency: claimMessageId(payload.id) — the SAME guard the Meta path
 * uses — so a Gupshup retry no-ops instead of re-running the LLM.
 *
 * Every recoverable issue returns 200 (anti-flood): a non-200 just makes
 * Gupshup retry the same webhook. 401 only on a positive auth failure.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { Logger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { resolveCompanyByGupshupApp } from '@/lib/companies/resolveByGupshupApp';
import { getGupshupCreds } from '@/lib/companies/creds';
import { claimMessageId } from '@/lib/inbox/messageIdClaim';
import { getPool } from '@/lib/db/client';
import { botQueue } from '@/lib/queue/queues';
import type { GupshupInboundEnvelope } from '@/lib/messaging/gupshup';
import type { ProcessGupshupTextInput } from '@/worker/tasks/processGupshupText';
import type { ProcessGupshupAudioInput } from '@/worker/tasks/processGupshupAudio';

/** Constant-time compare; false on any length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function persistRawInbound(
  appName: string,
  payload: unknown,
  logger: Logger,
): Promise<void> {
  try {
    await getPool().query(
      `INSERT INTO raw_inbound_messages (phone_number_id, payload)
       VALUES ($1, $2::jsonb)`,
      [`gupshup:${appName}`, JSON.stringify(payload)],
    );
  } catch (err) {
    logger.error(
      { appName, err: (err as Error)?.message },
      'persistRawInbound (gupshup) failed (non-fatal)',
    );
  }
}

export function makeGupshupReceiveHandler(logger: Logger) {
  return async function handleGupshupReceive(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // ── Auth. Operator-configured token, not a Meta-style HMAC. ──
    const configured = process.env.GUPSHUP_WEBHOOK_TOKEN;
    if (configured) {
      const headerVal = req.headers['apikey'];
      const presented = Array.isArray(headerVal) ? headerVal[0] : (headerVal ?? '');
      if (!safeEqual(presented, configured)) {
        logger.warn('Gupshup webhook rejected — apikey mismatch');
        await reply.status(401).send({ error: 'Unauthorized' });
        return;
      }
    } else {
      logger.warn(
        'GUPSHUP_WEBHOOK_TOKEN unset — accepting webhook unauthenticated. Set it (and IP-allowlist Gupshup) before production.',
      );
    }

    const body = req.body as GupshupInboundEnvelope | undefined;
    if (!body || typeof body !== 'object') {
      logger.warn('Gupshup webhook dropped — empty/invalid body');
      await reply.send({ status: 'ok' });
      return;
    }

    // Only inbound customer messages drive a bot turn. Everything else
    // (delivery/read receipts, sandbox-start) is acked and ignored.
    if (body.type !== 'message') {
      logger.info({ type: body.type }, 'Gupshup non-message event — acking');
      await reply.send({ status: 'ok' });
      return;
    }

    const appName = body.app ?? '';
    if (!appName) {
      logger.warn('Gupshup message missing app name — ignoring');
      await reply.send({ status: 'ok' });
      return;
    }

    const inner = body.payload ?? {};
    const customerPhone = inner.source as string | undefined;
    const messageId = inner.id as string | undefined;
    const msgType = inner.type as string | undefined;

    if (!customerPhone) {
      logger.warn('Gupshup message missing source — ignoring');
      await reply.send({ status: 'ok' });
      return;
    }

    let companyId: number | null;
    try {
      companyId = await resolveCompanyByGupshupApp(appName);
    } catch (err) {
      logger.error(
        { appName, err: (err as Error)?.message },
        'Gupshup webhook — DB lookup failed for company',
      );
      await reply.send({ status: 'ok' });
      return;
    }
    if (companyId === null) {
      await reply.send({ status: 'unroutable' });
      return;
    }

    await persistRawInbound(appName, body, logger);

    const creds = await getGupshupCreds(companyId);
    if (!creds) {
      logger.error({ companyId }, 'Company has no Gupshup credentials — cannot reply');
      await reply.send({ status: 'no_creds' });
      return;
    }
    // Idempotency — same guard the Meta path uses. A Gupshup retry no-ops.
    if (messageId) {
      const claimed = await claimMessageId(messageId);
      if (!claimed) {
        logger.info({ messageId }, 'Duplicate Gupshup delivery — skipping');
        await reply.send({ status: 'ok' });
        return;
      }
    }

    const sub = inner.payload ?? {};

    if (msgType === 'text') {
      const messageText = (sub.text as string | undefined) ?? '';
      if (!messageText.trim()) {
        logger.warn({ phone: maskPhone(customerPhone) }, 'Gupshup text with empty body');
        await reply.send({ status: 'ok' });
        return;
      }
      logger.info(
        { phone: maskPhone(customerPhone), companyId, type: 'text' },
        'Gupshup message received',
      );
      try {
        const data: ProcessGupshupTextInput = {
          customerPhone,
          messageText,
          companyId,
          creds,
        };
        await botQueue.add('gupshup-text', data);
      } catch (err) {
        logger.error(
          { phone: maskPhone(customerPhone), err: (err as Error).message },
          'process-text enqueue failed (gupshup)',
        );
      }
      await reply.send({ status: 'ok' });
      return;
    }

    if (msgType === 'audio' || msgType === 'voice') {
      const mediaUrl = sub.url as string | undefined;
      if (!mediaUrl) {
        logger.warn({ phone: maskPhone(customerPhone) }, 'Gupshup audio missing url');
        await reply.send({ status: 'ok' });
        return;
      }
      logger.info(
        { phone: maskPhone(customerPhone), companyId, type: 'audio' },
        'Gupshup message received',
      );
      try {
        const data: ProcessGupshupAudioInput = {
          customerPhone,
          mediaUrl,
          companyId,
          creds,
        };
        await botQueue.add('gupshup-audio', data);
      } catch (err) {
        logger.error(
          { phone: maskPhone(customerPhone), err: (err as Error).message },
          'gupshup-audio enqueue failed',
        );
      }
      await reply.send({ status: 'ok' });
      return;
    }

    logger.info({ phone: maskPhone(customerPhone), type: msgType }, 'Unsupported Gupshup message type');
    await reply.send({ status: 'ok' });
  };
}
