/**
 * Composable Route Handler wrappers.
 *
 *   withAuth(handler)   — gate behind requireAuth, pass AuthContext as 2nd arg
 *   withAdmin(handler)  — same as withAuth + role === 'admin'
 *   withCsrf(handler)   — verify the x-csrf-token header against the
 *                         session's csrfToken (allowlist-aware). Does NOT
 *                         require authentication on its own; if a route
 *                         needs both, wrap as withAuth(withCsrf(handler))
 *                         or compose at the call site.
 *   withErrors(handler) — catch HttpError and translate to a JSON response.
 *
 * Wrappers are designed so a Route Handler's signature stays compatible
 * with Next.js's expected (req, ctx) form — the AuthContext is injected
 * between them as the 2nd positional argument for auth wrappers.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { requireAuth, type AuthContext } from '@/lib/auth/requireAuth';
import { requireAdmin } from '@/lib/auth/requireAdmin';
import {
  SESSION_COOKIE_NAME,
  readSession,
  type SessionData,
} from '@/lib/auth/session';
import { verifySidFromEnv } from '@/lib/auth/cookies';
import { verifyCsrf } from '@/lib/auth/csrf';
import { HttpError, toJsonResponse, CsrfError } from './errors';

export type RouteCtx = unknown;

export type AuthedHandler<TCtx extends RouteCtx = RouteCtx> = (
  req: NextRequest,
  auth: AuthContext,
  ctx: TCtx,
) => Promise<Response> | Response;

export type PlainHandler<TCtx extends RouteCtx = RouteCtx> = (
  req: NextRequest,
  ctx: TCtx,
) => Promise<Response> | Response;

export function withAuth<TCtx extends RouteCtx = RouteCtx>(handler: AuthedHandler<TCtx>) {
  return async (req: NextRequest, ctx: TCtx): Promise<Response> => {
    const result = await requireAuth(req);
    if (result instanceof NextResponse) return result;
    return handler(req, result, ctx);
  };
}

export function withAdmin<TCtx extends RouteCtx = RouteCtx>(handler: AuthedHandler<TCtx>) {
  return async (req: NextRequest, ctx: TCtx): Promise<Response> => {
    const result = await requireAdmin(req);
    if (result instanceof NextResponse) return result;
    return handler(req, result, ctx);
  };
}

/**
 * Loads the session (if any) and runs verifyCsrf. Allowlist + safe-method
 * + unauthenticated cases pass through without a token. Rejects with 403
 * on mismatch or missing token for authenticated state-changing requests.
 */
export function withCsrf<TCtx extends RouteCtx = RouteCtx>(handler: PlainHandler<TCtx>) {
  return async (req: NextRequest, ctx: TCtx): Promise<Response> => {
    let session: SessionData | null = null;
    const raw = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (raw) {
      const sid = verifySidFromEnv(raw);
      if (sid) {
        const record = await readSession(sid);
        session = record?.data ?? null;
      }
    }
    const decision = verifyCsrf(req, session);
    if (!decision.ok) return toJsonResponse(new CsrfError());
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
