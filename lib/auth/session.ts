/**
 * Postgres-backed session store, wire-compatible with the express-session
 * + connect-pg-simple rows the legacy stack writes.
 *
 *   session.sid    varchar
 *   session.sess   json   ← the express-session payload below
 *   session.expire timestamp(6)
 *
 * The JSON keys preserved here match what server/index.ts:28-41 and
 * server/routes/auth.routes.ts:124-152 write at login time. Any deviation
 * would invalidate live sessions on the prod cutover.
 *
 *   authenticated, agentId, companyId, role, agentName,
 *   csrfToken, isActive, lastActiveCheck, termsAcceptedAt, webauthnChallenge
 *
 * plus the connect-pg-simple `cookie` sub-object that mirrors the
 * express-session cookie config (maxAge / httpOnly / sameSite / secure).
 *
 * Cookie name is connect.sid (express-session default).
 * Rolling 7-day expiry — writeSession bumps `expire` to now + TTL on every
 * write so an active user is never logged out mid-session.
 */

import { randomBytes } from 'node:crypto';
import { getPool } from '@/lib/db/client';

export const SESSION_COOKIE_NAME = 'connect.sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionCookieData {
  originalMaxAge: number;
  expires?: string;
  httpOnly: boolean;
  path: string;
  sameSite?: 'lax' | 'strict' | 'none' | boolean;
  secure?: boolean;
}

export interface SessionData {
  cookie?: SessionCookieData;
  authenticated?: boolean;
  agentId?: number | null;
  companyId?: number | null;
  role?: string;
  agentName?: string;
  csrfToken?: string;
  isActive?: boolean;
  lastActiveCheck?: number;
  termsAcceptedAt?: string | null;
  webauthnChallenge?: string;
}

export interface SessionRecord {
  sid: string;
  data: SessionData;
  expiresAt: Date;
}

export function generateSid(): string {
  return randomBytes(24).toString('base64url');
}

export async function readSession(sid: string): Promise<SessionRecord | null> {
  const r = await getPool().query<{ sess: SessionData; expire: Date }>(
    'SELECT sess, expire FROM session WHERE sid = $1',
    [sid],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (row.expire <= new Date()) return null;
  return { sid, data: row.sess, expiresAt: row.expire };
}

export async function writeSession(
  sid: string,
  data: SessionData,
  ttlMs: number = SESSION_TTL_MS,
): Promise<Date> {
  const expiresAt = new Date(Date.now() + ttlMs);
  const sess: SessionData = {
    ...data,
    cookie: {
      originalMaxAge: ttlMs,
      expires: expiresAt.toISOString(),
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      ...(data.cookie ?? {}),
    },
  };
  await getPool().query(
    `INSERT INTO session (sid, sess, expire) VALUES ($1, $2::json, $3)
     ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
    [sid, JSON.stringify(sess), expiresAt],
  );
  return expiresAt;
}

/**
 * Update only the `expire` column without rewriting the JSON payload.
 * Equivalent to connect-pg-simple's touch() — used for rolling-expiry
 * refreshes on requests that don't otherwise mutate the session.
 */
export async function touchSession(sid: string, ttlMs: number = SESSION_TTL_MS): Promise<Date> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await getPool().query('UPDATE session SET expire = $1 WHERE sid = $2', [expiresAt, sid]);
  return expiresAt;
}

export async function destroySession(sid: string): Promise<void> {
  await getPool().query('DELETE FROM session WHERE sid = $1', [sid]);
}

/** Cookie attributes for connect.sid — match server/index.ts:137-143. */
export function sessionCookieAttrs(ttlMs: number = SESSION_TTL_MS) {
  return {
    maxAge: Math.floor(ttlMs / 1000),  // Next cookies API uses seconds
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/' as const,
  };
}

/** Cookie attributes that clear connect.sid on the response. */
export function clearedSessionCookieAttrs() {
  return {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/' as const,
  };
}

/**
 * express-session's regenerate(): destroy the old row and create a fresh sid
 * carrying the supplied data forward. Called post-login to mitigate session
 * fixation (matches the Agents-side fix at server/routes/auth.routes.ts:124).
 */
export async function rotateSid(
  oldSid: string,
  data: SessionData,
  ttlMs: number = SESSION_TTL_MS,
): Promise<{ sid: string; expiresAt: Date }> {
  await destroySession(oldSid);
  const sid = generateSid();
  const expiresAt = await writeSession(sid, data, ttlMs);
  return { sid, expiresAt };
}
