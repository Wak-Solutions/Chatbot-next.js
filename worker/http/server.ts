/**
 * Worker HTTP server — minimal createServer wrapper, NOT Express.
 *
 * Routes:
 *   GET  /health   — DB-probed health check.
 *   GET  /webhook  — Meta verify-token handshake (PR 13).
 *   POST /webhook  — Meta inbound-message receive path (PR 13).
 *
 * The receive path runs each dispatch through the Semaphore singleton
 * passed in by the orchestrator (worker/index.ts) so a burst of webhooks
 * doesn't fan out into N simultaneous OpenAI calls.
 *
 * createWorkerServer returns the http.Server plus an awaitable close()
 * that resolves when `server.close()` completes — used by the
 * orchestrator's graceful-shutdown sequence.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logger } from '@/lib/logger';
import { makeHealthHandler } from './health';
import { makeWebhookVerifyHandler } from './webhookVerify';
import { makeWebhookReceiveHandler } from './webhookReceive';

export interface WorkerHttpServer {
  server: Server;
  close(): Promise<void>;
}

export interface CreateWorkerServerInput {
  logger: Logger;
}

export function createWorkerServer({ logger }: CreateWorkerServerInput): WorkerHttpServer {
  const handleHealth = makeHealthHandler(logger);
  const handleVerify = makeWebhookVerifyHandler(logger);
  const handleReceive = makeWebhookReceiveHandler(logger);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if ((req.method === 'GET' || req.method === 'HEAD') && url === '/health') {
      void handleHealth(req, res);
      return;
    }
    if (req.method === 'GET' && url.startsWith('/webhook')) {
      handleVerify(req, res);
      return;
    }
    if (req.method === 'POST' && url === '/webhook') {
      void handleReceive(req, res);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return {
    server,
    close(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
