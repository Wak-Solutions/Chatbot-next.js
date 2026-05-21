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

/**
 * TEMPORARY pass-through (see header). No CSRF check is performed.
 * Kept to preserve the existing wrapper composition at call sites
 * until a replacement CSRF strategy is decided.
 */
export function withCsrf<TCtx extends RouteCtx = RouteCtx>(handler: PlainHandler<TCtx>) {
  return async (req: NextRequest, ctx: TCtx): Promise<Response> => {
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
