/**
 * Worker HTTP server — Fastify wrapper replacing the bare node:http server.
 *
 * Routes:
 *   GET  /health   — DB-probed health check.
 *   GET  /webhook  — Meta verify-token handshake.
 *   POST /webhook  — Meta inbound-message receive path.
 *
 * Raw body access: `fastify-raw-body` plugin with `encoding: false` keeps
 * a raw Buffer on req.rawBody for each route that opts in via
 * `config: { rawBody: true }`. The webhook receive handler needs this for
 * HMAC-SHA256 signature verification — Fastify's default JSON parser would
 * discard the original bytes.
 *
 * createWorkerServer is async because plugin registration (fastify.register)
 * must resolve before routes are added. worker/index.ts awaits it.
 */

import Fastify from 'fastify';
import rawBody from 'fastify-raw-body';
import type { Logger } from '@/lib/logger';
import { makeHealthHandler } from './health';
import { makeWebhookVerifyHandler } from './webhookVerify';
import { makeWebhookReceiveHandler } from './webhookReceive';

export interface WorkerHttpServer {
  listen(port: number, host: string): Promise<void>;
  close(): Promise<void>;
}

export interface CreateWorkerServerInput {
  logger: Logger;
}

export async function createWorkerServer({
  logger,
}: CreateWorkerServerInput): Promise<WorkerHttpServer> {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
  });

  // encoding: false → rawBody is always a Buffer (needed for HMAC verify).
  // global: false   → opt-in per route via config: { rawBody: true }.
  await app.register(rawBody, { global: false, encoding: false });

  app.get('/health', makeHealthHandler(logger));
  app.get('/webhook', makeWebhookVerifyHandler(logger));
  app.post(
    '/webhook',
    { config: { rawBody: true } },
    makeWebhookReceiveHandler(logger),
  );

  return {
    async listen(port: number, host: string): Promise<void> {
      await app.listen({ port, host });
    },
    async close(): Promise<void> {
      await app.close();
    },
  };
}
