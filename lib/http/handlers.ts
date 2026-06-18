/**
 * Composable Route Handler wrappers (Phase 3 — Auth.js v5).
 *
 *   withAuth(handler)   — gate behind Auth.js auth(); pass AuthContext
 *                         as 2nd arg. Returns 401 JSON on miss.
 *   withAdmin(handler)  — same as withAuth + role === 'admin'.
 *                         Returns 403 JSON on non-admin.
 *   withCsrf(handler)   — TEMPORARY pass-through. Phase 3 deleted
 *                         lib/auth/csrf.ts per the manager's spec
 *                         (Auth.js v5 only CSRF-protects its own
 *                         /api/auth/* routes, not our app's POSTs).
 *                         Kept callable so call sites compile; a
 *                         replacement CSRF strategy is a follow-up.
 *   withErrors(handler) — catch HttpError and translate to JSON.
 *
 * The Server-Component-only requireAuth/requireAdmin (which `redirect()`
 * on miss) are unsuitable for route handlers — route handlers must
 * return a Response. These wrappers call Auth.js's auth() directly
 * and produce JSON responses on auth failure.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { HttpError, toJsonResponse } from './errors';

export type RouteCtx = unknown;

/** Shape passed to authed handlers. Matches the legacy AuthContext fields
 * the existing 57 protected routes already consume. */
export interface AuthContext {
  agentId: number;
  companyId: number;
  role: 'admin' | 'agent';
  agentName?: string;
}

export type AuthedHandler<TCtx extends RouteCtx = RouteCtx> = (
  req: NextRequest,
  auth: AuthContext,
  ctx: TCtx,
) => Promise<Response> | Response;

export type PlainHandler<TCtx extends RouteCtx = RouteCtx> = (
  req: NextRequest,
  ctx: TCtx,
) => Promise<Response> | Response;

async function resolveAuth(): Promise<AuthContext | NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  return {
    agentId: Number(session.user.id),
    companyId: session.user.companyId,
    role: session.user.role,
    agentName: session.user.name ?? undefined,
  };
}

export function withAuth<TCtx extends RouteCtx = RouteCtx>(handler: AuthedHandler<TCtx>) {
  return async (req: NextRequest, ctx: TCtx): Promise<Response> => {
    const result = await resolveAuth();
    if (result instanceof NextResponse) return result;
    return handler(req, result, ctx);
  };
}

export function withAdmin<TCtx extends RouteCtx = RouteCtx>(handler: AuthedHandler<TCtx>) {
  return async (req: NextRequest, ctx: TCtx): Promise<Response> => {
    const result = await resolveAuth();
    if (result instanceof NextResponse) return result;
    if (result.role !== 'admin') {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }
    return handler(req, result, ctx);
  };
}

/** Company 1 (WAK Solutions) is the platform owner — see the demo-booking /
 * meetings routes that hardcode company_id = 1. Its admins are the only ones
 * allowed to manage other tenants' subscriptions. */
export const PLATFORM_OWNER_COMPANY_ID = 1;

export function withPlatformAdmin<TCtx extends RouteCtx = RouteCtx>(handler: AuthedHandler<TCtx>) {
  return async (req: NextRequest, ctx: TCtx): Promise<Response> => {
    const result = await resolveAuth();
    if (result instanceof NextResponse) return result;
    if (result.role !== 'admin' || result.companyId !== PLATFORM_OWNER_COMPANY_ID) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }
    return handler(req, result, ctx);
  };
}

/**
 * CSRF guard backed by Auth.js v5's own csrf-token cookie. Auth.js
 * issues the cookie at first visit (HttpOnly, signed `<token>|<hmac>`
 * with AUTH_SECRET) and exposes the raw token via /api/auth/csrf.
 * Client picks the token up via next-auth/react.getCsrfToken() and
 * sends it on state-changing requests as `x-csrf-token`. This wrapper
 * compares the header against the cookie's token portion — double-
 * submit, same cookie, same secret, no extra storage.
 *
 * GET / HEAD / OPTIONS are pass-through (browsers don't pre-flight CSRF
 * on safe methods; nothing state-changing happens).
 */
const CSRF_COOKIE_NAMES = ['__Host-authjs.csrf-token', 'authjs.csrf-token'] as const;

function safeStringEq(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:crypto').timingSafeEqual(ba, bb);
}

export function withCsrf<TCtx extends RouteCtx = RouteCtx>(handler: PlainHandler<TCtx>) {
  return async (req: NextRequest, ctx: TCtx): Promise<Response> => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return handler(req, ctx);
    }

    let cookieValue: string | undefined;
    for (const name of CSRF_COOKIE_NAMES) {
      cookieValue = req.cookies.get(name)?.value;
      if (cookieValue) break;
    }
    if (!cookieValue) {
      return NextResponse.json({ message: 'CSRF cookie missing' }, { status: 403 });
    }

    // Auth.js stores the cookie as "<token>|<hmac-hex>" — the token is
    // what /api/auth/csrf returns to the client. Compare that portion.
    const cookieToken = cookieValue.split('|')[0] ?? '';
    const headerToken = req.headers.get('x-csrf-token') ?? '';
    if (!cookieToken || !headerToken || !safeStringEq(cookieToken, headerToken)) {
      return NextResponse.json({ message: 'CSRF token mismatch' }, { status: 403 });
    }

    return handler(req, ctx);
  };
}

/**
 * Catch HttpError thrown inside the handler and return its JSON envelope.
 * Other throws bubble — Next.js's default 500 handler will format them.
 */
export function withErrors<TCtx extends RouteCtx = RouteCtx>(handler: PlainHandler<TCtx>) {
  return async (req: NextRequest, ctx: TCtx): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return toJsonResponse(err);
      throw err;
    }
  };
}
