/**
 * Bull Board — BullMQ queue monitoring UI, admin-only.
 *
 * Mount: /api/admin/queues   (catch-all serves the UI page and every
 *                             sub-path — static assets and API calls)
 *
 * Bridge architecture — DO NOT "SIMPLIFY"
 *
 *   The naive `export const { GET, POST } = serverAdapter.registerHandlers()`
 *   pattern looks tempting but CRASHES under Next.js App Router. Bull Board's
 *   H3Adapter returns an h3 Router (h3 v1), whose handlers expect an h3 event
 *   object (with event.node.req / event.node.res). Next.js route handlers
 *   receive a Web Request and must return a Web Response. The shapes don't
 *   match — every Bull Board request would throw at the first
 *   `getRouterParams(event)` / `readBody(event)` call.
 *
 *   The bridge fixes this:
 *     1. createApp() — an h3 App that accepts a Router via .use()
 *     2. app.use(serverAdapter.registerHandlers()) — mounts the adapter
 *     3. toWebHandler(app) — converts the App into a (req: Request) =>
 *        Promise<Response> function that Next.js can call directly.
 *
 *   Version pinning matters: @bull-board/h3@7.x is built against h3 v1.
 *   Our top-level h3 is pinned to ^1.15.11 so npm dedupes to a single
 *   instance — both the adapter's Router and our App/toWebHandler share
 *   the same h3 module. Using h3 v2 here would silently install a second
 *   incompatible copy and the bridge would fail at instanceof checks.
 *
 *   If you're tempted to refactor: don't. Add comments instead.
 *
 * Lazy init — DO NOT MOVE the queues import to module top
 *
 *   `import { botQueue, cronQueue } from '@/lib/queue/queues'` triggers
 *   `new Queue(..., { connection: getConnection() })` at module-load
 *   time, which calls `getWorkerEnv()` and Zod-validates worker-only
 *   env vars (REDIS_URL, VERIFY_TOKEN). Next.js's "Collecting page
 *   data" phase evaluates every route module during build — even with
 *   dynamic='force-dynamic' — so a top-level import here crashes
 *   `npm run build:app` AND the app service's Railway deploy unless
 *   both env vars are set on the app service. Deferring the queue
 *   import + Bull Board setup until the first request keeps build +
 *   deploy clean and only pays the cost when an admin actually opens
 *   the dashboard.
 *
 * Auth: every method is wrapped in withAdmin (returns JSON 401 for
 * unauthenticated, 403 for non-admin). Because Next.js calls our exported
 * GET/POST/PUT/PATCH for every URL under the catch-all (including
 * /api/admin/queues/static/*.js, /api/admin/queues/api/queues, etc.), the
 * guard fires on every request — sub-paths included.
 *
 * Methods: GET, POST, PUT, PATCH. Inspected @bull-board/api@7.1.5 routes:
 *   6 GET, 1 POST, 13 PUT (most actions), 1 PATCH, 0 DELETE.
 *
 * Runtime: nodejs (BullMQ + ioredis need Node APIs; Edge would break).
 * Caching: force-dynamic (live queue data, never statically optimised).
 */

import { withAdmin } from '@/lib/http/handlers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Memoised on first request — see header comment for why this can't be
// constructed at module top.
let _webHandler: ((req: Request) => Promise<Response>) | null = null;

async function getWebHandler(): Promise<(req: Request) => Promise<Response>> {
  if (_webHandler) return _webHandler;

  const [{ createBullBoard }, { BullMQAdapter }, { H3Adapter }, { createApp, toWebHandler }, { botQueue, cronQueue }] =
    await Promise.all([
      import('@bull-board/api'),
      import('@bull-board/api/bullMQAdapter'),
      import('@bull-board/h3'),
      import('h3'),
      import('@/lib/queue/queues'),
    ]);

  const serverAdapter = new H3Adapter().setBasePath('/api/admin/queues');
  createBullBoard({
    queues: [new BullMQAdapter(botQueue), new BullMQAdapter(cronQueue)],
    serverAdapter,
  });

  // h3 v1 Router → h3 App → Web handler. See header comment.
  const app = createApp();
  app.use(serverAdapter.registerHandlers());
  _webHandler = toWebHandler(app);
  return _webHandler;
}

async function delegate(req: Request): Promise<Response> {
  const handler = await getWebHandler();
  return handler(req);
}

export const GET   = withAdmin(async (req) => delegate(req));
export const POST  = withAdmin(async (req) => delegate(req));
export const PUT   = withAdmin(async (req) => delegate(req));
export const PATCH = withAdmin(async (req) => delegate(req));
