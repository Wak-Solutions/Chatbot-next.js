/**
 * Meta webhook GET handshake — port of Chatbot/routes/webhook.py:22.
 *
 * Meta sends ?hub.mode=subscribe&hub.verify_token=<…>&hub.challenge=<…>
 * during the App Console webhook URL setup. The verify_token is a single
 * global value (Meta's webhook model registers one URL/token per App,
 * not per phone_number_id) — same VERIFY_TOKEN env var the legacy
 * Python service used. Refuses to verify if the worker started without
 * VERIFY_TOKEN set (the env loader catches this at boot).
 *
 *   Match → 200 text/plain with the challenge value.
 *   Miss  → 403 text/plain.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from '@/lib/logger';

export function makeWebhookVerifyHandler(logger: Logger) {
  return function handleVerify(req: IncomingMessage, res: ServerResponse): void {
    const verifyToken = process.env.VERIFY_TOKEN;
    if (!verifyToken) {
      logger.error('VERIFY_TOKEN not set — refusing to verify');
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Misconfigured');
      return;
    }

    const url = new URL(req.url ?? '/', 'http://localhost');
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') ?? '';

    logger.info({ mode }, 'Webhook verification request');

    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('Webhook verified successfully');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(challenge);
      return;
    }

    logger.warn('Webhook verification failed — token mismatch');
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
  };
}
