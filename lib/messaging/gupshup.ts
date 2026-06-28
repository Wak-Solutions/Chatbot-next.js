/**
 * Gupshup WhatsApp API wrapper — the Gupshup analogue of
 * lib/messaging/whatsapp.ts (Meta).
 *
 * We reach WhatsApp through Gupshup as our BSP (apps provisioned via Bread
 * Crumbs as the ISV). Same WhatsApp channel as Meta — different API surface:
 *
 *   send     : POST https://api.gupshup.io/wa/api/v1/msg
 *              header   apikey: <per-company key>
 *              encoding application/x-www-form-urlencoded
 *              form     channel=whatsapp & source=<business #> &
 *                       destination=<customer #> & src.name=<app name> &
 *                       message=<JSON typed payload>
 *
 *   inbound  : Gupshup POSTs JSON to our webhook. No HMAC signature (unlike
 *              Meta's x-hub-signature-256) — auth is an operator-configured
 *              header + IP allowlist. See worker/http/gupshupReceive.ts.
 *
 * 10s timeout per request, no retries — matches the Meta wrapper.
 */

import { createLogger } from '@/lib/logger';
import { maskPhone, sanitizePhone } from '@/lib/phone';

const logger = createLogger('gupshup');

const GUPSHUP_MSG_URL = 'https://api.gupshup.io/wa/api/v1/msg';
const GUPSHUP_TIMEOUT_MS = 10_000;

export interface GupshupSendCreds {
  apiKey: string;
  appName: string;
  /** Sending WhatsApp business number (digits only). */
  source: string;
}

export async function sendGupshupText(input: {
  phone: string;
  body: string;
  apiKey: string;
  appName: string;
  source: string;
}): Promise<boolean> {
  const to = sanitizePhone(input.phone);
  if (!to) {
    logger.error('sendGupshupText skipped — empty phone');
    return false;
  }
  const source = sanitizePhone(input.source);
  if (!source) {
    logger.error('sendGupshupText skipped — empty source number');
    return false;
  }

  // Gupshup's /msg accepts the message body as a JSON-encoded typed object.
  const form = new URLSearchParams({
    channel: 'whatsapp',
    source,
    destination: to,
    'src.name': input.appName,
    message: JSON.stringify({ type: 'text', text: input.body }),
  });

  try {
    const res = await fetch(GUPSHUP_MSG_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        apikey: input.apiKey,
        accept: 'application/json',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(GUPSHUP_TIMEOUT_MS),
    });
    // Read the body once regardless of res.ok (res.text() is single-use) so we
    // can log Gupshup's actual response (status + messageId) on success too —
    // needed to debug "accepted but not delivered to the customer".
    const rawBody = await res.text().catch(() => '');
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }

    if (!res.ok) {
      logger.error(
        { phone: maskPhone(to), status: res.status, body: rawBody.slice(0, 200) },
        'Gupshup send failed',
      );
      return false;
    }
    logger.info(
      { phone: maskPhone(to), status: res.status, gupshupResponse: parsedBody },
      'WhatsApp sent (gupshup)',
    );
    return true;
  } catch (err) {
    logger.error(
      { phone: maskPhone(to), err: (err as Error)?.message },
      'Gupshup send exception',
    );
    return false;
  }
}

// ── Inbound webhook payload shapes ─────────────────────────────────────────
// Gupshup wraps every callback in { app, timestamp, version, type, payload }.
// We only act on type === 'message'; 'message-event' (delivery/read) and
// 'user-event' (sandbox-start) are acked and ignored.

export interface GupshupInboundEnvelope {
  app?: string;
  timestamp?: number;
  version?: number;
  type?: string; // 'message' | 'message-event' | 'user-event' | ...
  payload?: {
    id?: string; // message id (idempotency key)
    source?: string; // customer phone
    type?: string; // 'text' | 'audio' | 'voice' | 'image' | 'video' | 'file' | ...
    payload?: {
      text?: string; // text body
      url?: string; // media direct URL (audio/image/...)
      contentType?: string;
      [k: string]: unknown;
    };
    sender?: { phone?: string; name?: string };
    [k: string]: unknown;
  };
}
