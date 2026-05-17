/**
 * In-memory fixed-window rate limiter, per-process. Same semantics as the
 * default express-rate-limit memory store the legacy server uses, so
 * parity is preserved on a single-replica deploy.
 *
 * Ported pre-configured limiters mirror the originals:
 *
 *   - publicTokenLimiter — 20 / 15 min / IP
 *       server/routes/meetings.routes.ts:84 (booking link lookups)
 *   - bookingLimiter — alias of publicTokenLimiter
 *       Same shape; named separately so callers documenting "booking"
 *       intent read clearly.
 *   - authForgotLimiter — 5 / 15 min / IP
 *       server/routes/auth.routes.ts:451 (password-reset request)
 *   - authResetLimiter — 10 / 15 min / IP
 *       server/routes/auth.routes.ts:458 (consume reset token)
 *   - openAiLimiter — 10 / min / company
 *       server/routes/chatbot-config.routes.ts:211
 *
 * Buckets are never explicitly evicted; a stale bucket is overwritten on
 * its next `check()` after its window has passed. Memory grows with the
 * number of distinct keys seen per window — acceptable here because the
 * key space is bounded (IPs and small company-id sets).
 */

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
}

export interface RateLimitDecision {
  ok: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitDecision;
  reset(key?: string): void;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  if (opts.windowMs <= 0 || opts.max <= 0) {
    throw new Error('rateLimit: windowMs and max must be positive');
  }
  const buckets = new Map<string, Bucket>();
  return {
    check(key: string): RateLimitDecision {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket || now >= bucket.resetAt) {
        bucket = { count: 0, resetAt: now + opts.windowMs };
        buckets.set(key, bucket);
      }
      bucket.count++;
      const remaining = Math.max(0, opts.max - bucket.count);
      const ok = bucket.count <= opts.max;
      return {
        ok,
        remaining,
        resetAt: bucket.resetAt,
        retryAfterMs: ok ? 0 : Math.max(0, bucket.resetAt - now),
      };
    },
    reset(key) {
      if (key === undefined) buckets.clear();
      else buckets.delete(key);
    },
  };
}

// publicTokenLimiter — 20 / 15 min / IP, applied to /api/meeting/:token
// (booking-link lookups, server/routes/meetings.routes.ts:84).
export const publicTokenLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
// bookingLimiter — 10 / 15 min / IP, applied to /api/book/ (public booking
// page, server/routes.ts:103). Originally aliased to publicTokenLimiter in
// PR 4 — corrected in PR 7 ahead of the /api/book/ port in PR 8.
export const bookingLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
export const authForgotLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
export const authResetLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10 });
export const openAiLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10 });

// authEntryLimiter — 20 / 15 min / IP. Applied to /api/login, /api/register
// (entry only — sub-steps are session-gated), and the WebAuthn login-verify
// endpoint. Defined in server/routes.ts:110-116 (not auth.routes.ts).
export const authEntryLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

// authChangePasswordLimiter — 5 / 15 min, KEYED BY agentId at the call site
// (not IP). Defends against a compromised-session brute-force on one agent's
// current password regardless of IP rotation. IP keying would be bypassed by
// any attacker rotating IPs and would over-restrict agents on shared NAT.
// Matches the legacy keyer at server/routes/settings.routes.ts:293
// (`cp:${req.session?.agentId ?? ip}`); the IP fallback is unreachable on
// this endpoint because withAuth runs first.
export const authChangePasswordLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5 });
