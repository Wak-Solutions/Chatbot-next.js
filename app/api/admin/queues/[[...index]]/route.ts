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

// Two Windows-specific issues require special handling in delegate():
//
// 1. Trailing-slash mismatch
//    Bull Board registers the entry route as `${basePath}/` (with slash).
//    Browsers navigate to /api/admin/queues (no slash).  h3 finds no
//    match → "Cannot find any path matching /." 404.
//    Fix: 302-redirect the bare base-path to itself + '/'.
//
// 2. Static-file 404 on Windows  (@bull-board/h3 bug)
//    H3Adapter.getStaticPath() calls node:path.normalize() on the URL
//    path.  On Windows, normalize() converts forward-slashes to
//    backslashes, so the subsequent .replace(forwardSlashPrefix, '')
//    never matches → getStaticPath returns '' → readFileSync throws
//    → getMeta returns undefined → serveStatic returns 404.
//    Fix: intercept /…/static/* here and read from the UI package
//    directly via path.resolve (backslash-safe + traversal-safe).

import { readFileSync } from 'node:fs';
import nodePath from 'node:path';

const BULL_BASE  = '/api/admin/queues';
const STATIC_PFX = `${BULL_BASE}/static/`;

const UI_STATIC_DIR = nodePath.resolve(
  process.cwd(),
  'node_modules/@bull-board/ui/dist/static',
);

const MIME: Record<string, string> = {
  '.css':   'text/css; charset=utf-8',
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.ico':   'image/x-icon',
  '.json':  'application/json; charset=utf-8',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

function serveStaticFile(pathname: string): Response {
  const rel = pathname.slice(STATIC_PFX.length);          // 'css/main.abc.css'
  const abs = nodePath.resolve(UI_STATIC_DIR, rel);       // native OS path
  // Guard: never escape the static directory.
  if (!abs.startsWith(UI_STATIC_DIR + nodePath.sep) && abs !== UI_STATIC_DIR) {
    return new Response('Forbidden', { status: 403 });
  }
  try {
    const body = readFileSync(abs);
    const ext  = nodePath.extname(rel).toLowerCase();
    return new Response(body, {
      headers: { 'Content-Type': MIME[ext] ?? 'application/octet-stream' },
    });
  } catch {
    return new Response('Not Found', { status: 404 });
  }
}

async function delegate(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  // Serve static assets directly (bypasses the Windows path bug — see above).
  if (pathname.startsWith(STATIC_PFX)) {
    return serveStaticFile(pathname);
  }

  const handler = await getWebHandler();

  // Bull Board's entry route is registered at `${basePath}/` (trailing slash).
  // Next.js normalises URLs by stripping trailing slashes before our handler
  // sees them, so the browser redirect trick creates an infinite loop.
  // Instead, rewrite the URL internally so h3 sees the slash it needs.
  if (pathname === BULL_BASE) {
    const url = new URL(req.url);
    url.pathname = `${BULL_BASE}/`;
    return handler(new Request(url, req));
  }

  return handler(req);
}

export const GET   = withAdmin(async (req) => delegate(req));
export const POST  = withAdmin(async (req) => delegate(req));
export const PUT   = withAdmin(async (req) => delegate(req));
export const PATCH = withAdmin(async (req) => delegate(req));
