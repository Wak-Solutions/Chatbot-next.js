/**
 * Signed-cookie helpers, wire-compatible with cookie-signature@1.x — the
 * package express-session uses to sign session ids. Format:
 *
 *   s:<sid>.<HMAC-SHA256(sid, SESSION_SECRET) base64 with trailing '=' stripped>
 *
 * The "s:" prefix and the base64-stripped HMAC are the parts of the wire
 * format that must stay identical so existing prod sessions verify after
 * cutover.
 *
 * signSid / verifySid take an explicit secret for testability and purity.
 * The *FromEnv variants pull SESSION_SECRET via a minimal Zod schema so
 * this module doesn't depend on loadAppEnv() (which validates the full
 * app env and would over-fetch when only the session secret is needed).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export function signSid(sid: string, secret: string): string {
  const sig = createHmac('sha256', secret)
    .update(sid)
    .digest('base64')
    .replace(/=+$/, '');
  return `s:${sid}.${sig}`;
}

export function verifySid(signed: string, secret: string): string | null {
  if (typeof signed !== 'string' || !signed.startsWith('s:')) return null;
  const value = signed.slice(2);
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;
  const sid = value.slice(0, dot);
  const expected = signSid(sid, secret);
  const a = Buffer.from(signed);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? sid : null;
}

const sessionSecretSchema = z.object({ SESSION_SECRET: z.string().min(32) });
let cachedSecret: string | null = null;

export function getSessionSecret(source: NodeJS.ProcessEnv = process.env): string {
  if (cachedSecret) return cachedSecret;
  cachedSecret = sessionSecretSchema.parse(source).SESSION_SECRET;
  return cachedSecret;
}

export function signSidFromEnv(sid: string): string {
  return signSid(sid, getSessionSecret());
}

export function verifySidFromEnv(signed: string): string | null {
  return verifySid(signed, getSessionSecret());
}
