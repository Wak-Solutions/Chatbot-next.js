/**
 * OBSERVE-ONLY debug endpoint — POST /gupshup-v3.
 *
 * Temporary, purely additive route to discover what Gupshup's v3
 * (Meta-format) coexistence + delivery-status callbacks actually look like.
 * Our live v2 /gupshup handler (gupshupReceive.ts) only parses inbound user
 * messages and discards 'message-event' delivery reports; coexistence +
 * delivery events are only available under the Meta v3 format. This route
 * lets us see those payloads WITHOUT touching anything.
 *
 * Behaviour — minimal and safe:
 *   - Reads the raw body, parses JSON (tolerates parse failure).
 *   - Logs the ENTIRE payload at info level, plus a best-effort summary
 *     (event type / messageId / status / failure reason) probed defensively
 *     against the Meta WhatsApp shape — never assumes fields exist.
 *   - ALWAYS returns 200 { status: 'ok' }. Never 4xx/5xx, so Gupshup never
 *     marks the endpoint invalid.
 *   - Auth is optional + lenient: if GUPSHUP_WEBHOOK_TOKEN is set we log
 *     whether the apikey header matched, but we NEVER reject.
 *   - Does NOT enqueue jobs, call getReply, write the DB, or send anything.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import 'fastify-raw-body';
import type { Logger } from '@/lib/logger';

/**
 * Best-effort, non-throwing probe for the interesting fields in a Meta
 * WhatsApp v3 payload (entry[].changes[].value.statuses[] / messages[]).
 * Returns null if the shape doesn't match — the full body dump still has
 * everything either way. Assumes nothing is present.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function summariseV3(body: any): Record<string, unknown> | null {
  try {
    const out: Record<string, unknown> = {};
    const value = body?.entry?.[0]?.changes?.[0]?.value;

    const status = value?.statuses?.[0];
    if (status) {
      out.evt = 'status';
      if (status.id) out.messageId = status.id;
      if (status.status) out.status = status.status; // sent | delivered | read | failed
      if (status.recipient_id) out.recipient = status.recipient_id;
      const err = status.errors?.[0];
      if (err) {
        out.errorCode = err.code;
        out.errorTitle = err.title;
        out.errorMessage = err.message ?? err.error_data?.details;
      }
    }

    const msg = value?.messages?.[0];
    if (msg) {
      out.evt = out.evt ?? 'message';
      if (msg.id) out.inboundMessageId = msg.id;
      if (msg.from) out.from = msg.from;
    }

    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

export function makeGupshupV3Handler(logger: Logger) {
  return async function handleGupshupV3(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Optional, lenient auth — observe whether a token was presented, but
    // NEVER reject (validation/test pings must always pass).
    const configured = process.env.GUPSHUP_WEBHOOK_TOKEN;
    if (configured) {
      const headerVal = req.headers['apikey'];
      const presented = Array.isArray(headerVal) ? headerVal[0] : (headerVal ?? '');
      logger.info(
        {
          source: 'gupshup-v3',
          apikeyPresented: presented.length > 0,
          apikeyMatches: presented === configured,
        },
        'gupshup-v3 auth (observe-only, never rejects)',
      );
    }

    const rawBody = (req.rawBody as Buffer | undefined) ?? Buffer.alloc(0);
    const text = rawBody.toString('utf8');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body: any;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined;
    }

    if (body !== undefined) {
      logger.info({ source: 'gupshup-v3', body }, 'gupshup-v3 event received');
      const summary = summariseV3(body);
      if (summary) {
        logger.info({ source: 'gupshup-v3', ...summary }, 'gupshup-v3 event summary');
      }
    } else {
      // Couldn't parse JSON — still log the raw text so nothing is lost.
      logger.info(
        { source: 'gupshup-v3', raw: text.slice(0, 4000) },
        'gupshup-v3 event received (non-JSON / empty body)',
      );
    }

    await reply.send({ status: 'ok' });
  };
}
