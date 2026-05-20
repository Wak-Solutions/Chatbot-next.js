/**
 * Double-submit-cookie CSRF.
 *
 * On every authenticated request we keep `csrf-token` (non-HttpOnly) in
 * sync with session.csrfToken (HttpOnly, signed). State-changing requests
 * must send the same value back in the `x-csrf-token` header; the server
 * compares header → session and rejects on mismatch.
 *
 * Allowlist policy:
 *
 *   - Webhook paths (no session, called by external systems): /api/book/.
 *     Historical entries /api/incoming, /api/human-requested, and
 *     /api/meetings/create-token were removed when their routes were
 *     deleted in PR 13 (worker now owns inbound + token issuance).
 *
 *   - Public auth paths (intentionally accept POST without a CSRF token
 *     because the user has no session yet): login, logout, /api/auth/webauthn,
 *     /api/register, /api/auth/forgot-password, /api/auth/reset-password,
 *     /api/push/subscribe. Sourced from shared/routes.ts where possible —
 *     drift between this allowlist and the actual route paths caused a
 *     P0 login 403 (see server/routes.ts:166 for the historical incident
 *     comment).
 */

import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { api } from '@/lib/contracts/routes';
import { SESSION_TTL_MS, type SessionData } from './session';

export const CSRF_COOKIE_NAME = 'csrf-token';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const WEBHOOK_ALLOWLIST = new Set<string>([
  '/api/book/',
]);

const PUBLIC_AUTH_PREFIXES: readonly string[] = [
  api.auth.login.path,
  api.auth.logout.path,
  '/api/auth/webauthn',
  '/api/register',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/push/subscribe',
];

export interface CsrfCookieValue {
  /** Value to write into the csrf-token cookie. */
  value: string;
  /** Cookie attributes — mirror the legacy setCsrfCookie config. */
  options: {
    httpOnly: false;
    sameSite: 'strict';
    secure: boolean;
    path: '/';
    maxAge: number;
  };
}

/**
 * Ensure session.csrfToken exists (mutates `session` in place), and
 * return the cookie payload the caller should set on the response.
 *
 * maxAge matches SESSION_TTL_MS so the cookie outlives a browser
 * restart. Without it, browsers treat the cookie as a session cookie
 * and wipe it on tab/window close, even though the server-side session
 * (and its csrfToken) survive — the next POST then hits 403 with an
 * empty header. Caused the book-a-demo / send-message intermittent 403s.
 */
export function setCsrfCookie(session: SessionData): CsrfCookieValue {
  if (!session.csrfToken) {
    session.csrfToken = randomBytes(32).toString('hex');
  }
  return {
    value: session.csrfToken,
    options: {
      httpOnly: false,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    },
  };
}

export interface CsrfDecision {
  ok: boolean;
  reason?: 'method' | 'webhook-allowlist' | 'public-allowlist' | 'unauthenticated' | 'match' | 'missing' | 'mismatch';
}

/**
 * Decide whether a request passes CSRF protection.
 *
 *   - Safe methods (GET/HEAD/OPTIONS) → always ok.
 *   - Webhook allowlist → ok (callers are non-browser).
 *   - Public-auth allowlist → ok (no session yet to bind a token to).
 *   - Unauthenticated session → ok (nothing to forge against).
 *   - Otherwise: compare x-csrf-token header against session.csrfToken;
 *     mismatch or missing rejects.
 */
export function verifyCsrf(request: NextRequest, session: SessionData | null): CsrfDecision {
  const method = request.method.toUpperCase();
  if (!STATE_CHANGING_METHODS.has(method)) return { ok: true, reason: 'method' };

  const path = new URL(request.url).pathname;
  if ([...WEBHOOK_ALLOWLIST].some((p) => path.startsWith(p))) {
    return { ok: true, reason: 'webhook-allowlist' };
  }
  if (PUBLIC_AUTH_PREFIXES.some((p) => path.startsWith(p))) {
    return { ok: true, reason: 'public-allowlist' };
  }

  if (!session?.authenticated) return { ok: true, reason: 'unauthenticated' };

  const header = request.headers.get(CSRF_HEADER_NAME);
  if (!header) return { ok: false, reason: 'missing' };
  if (header !== session.csrfToken) return { ok: false, reason: 'mismatch' };
  return { ok: true, reason: 'match' };
}
