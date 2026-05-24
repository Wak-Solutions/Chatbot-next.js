/**
 * Meta webhook GET handshake — Fastify route handler shape.
 *
 * Meta sends ?hub.mode=subscribe&hub.verify_token=<…>&hub.challenge=<…>
 * during App Console webhook URL setup. Compares verify_token against
 * the VERIFY_TOKEN env var. Echoes hub.challenge on match; 403 on miss.
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from '@/lib/logger';

export function makeWebhookVerifyHandler(logger: Logger) {
  return async function handleVerify(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const verifyToken = process.env.VERIFY_TOKEN;
    if (!verifyToken) {
      logger.error('VERIFY_TOKEN not set — refusing to verify');
      await reply.status(500).type('text/plain').send('Misconfigured');
      return;
    }

    const query = req.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'] ?? '';

    logger.info({ mode }, 'Webhook verification request');

    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('Webhook verified successfully');
      await reply.type('text/plain').send(challenge);
      return;
    }

    logger.warn('Webhook verification failed — token mismatch');
    await reply.status(403).type('text/plain').send('Forbidden');
  };
}
