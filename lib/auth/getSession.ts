/**
 * Single source of truth for session resolution. Used by:
 *
 *   - lib/auth/requireAuth.ts (HTTP route guard — returns NextResponse on miss)
 *   - app/(auth)/layout.tsx   (Server Component gate — calls redirect() on miss)
 *
 * Keeping the cookie read + sid verify + session lookup + SR-013 60s
 * is_active recheck + trial gate in ONE place means a future rule
 * change to any of those steps lands in both code paths automatically.
 * Previously the layout inlined the chain, creating a parallel path
 * that could silently drift — opening a lockout-evasion window where
 * a deactivated user sees the dashboard shell until the next API call.
 *
 * Returns a discriminated union so each caller can decide how to react
 * (HTTP status code vs. redirect path) while sharing all the gate logic.
 *
 * Side effects mirror the legacy requireAuth verbatim:
 *   - writeSession on the post-recheck JSON update
 *   - destroySession on detected deactivation
 *   - fail-OPEN on transient DB errors during the recheck (per the
 *     comment in server/middleware/auth.ts:111)
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import {
  destroySession,
  readSession,
  writeSession,
  type SessionData,
} from './session';
import { verifySidFromEnv } from './cookies';
import { getCompanyTrialStatus, isTrialExempt } from './trial';

const logger = createLogger('auth-session');

const ACTIVE_RECHECK_TTL_MS = 60_000;

export interface AuthContext {
  companyId: number;
  agentId: number;
  role: string;
  agentName: string;
  isActive: boolean;
}

export interface SessionResolutionInput {
  /** Raw value of the connect.sid cookie (signed). Undefined if absent. */
  cookieValue: string | undefined | null;
  /** Pathname for trial-exemption check (e.g. '/api/me' is exempt). */
  path: string;
}

export type SessionResolutionResult =
  | { kind: 'unauthorized' }
  | { kind: 'deactivated' }
  | { kind: 'service-unavailable' }
  | { kind: 'trial-expired'; auth: AuthContext; trialDays: number; expiresAt: string | null }
  | { kind: 'authorized'; auth: AuthContext };

export async function resolveSession(
  input: SessionResolutionInput,
): Promise<SessionResolutionResult> {
  const { cookieValue, path } = input;

  if (!cookieValue) return { kind: 'unauthorized' };
  const sid = verifySidFromEnv(cookieValue);
  if (!sid) return { kind: 'unauthorized' };

  const record = await readSession(sid);
  if (!record) return { kind: 'unauthorized' };
  const session: SessionData = record.data;

  if (!session.authenticated) return { kind: 'unauthorized' };

  const cid = Number(session.companyId);
  if (!Number.isInteger(cid) || cid <= 0) {
    return { kind: 'unauthorized' };
  }

  let isActive = session.isActive;
  if (isActive === undefined) {
    const agent = await getPool().query<{ is_active: boolean | null }>(
      'SELECT is_active FROM agents WHERE id = $1',
      [session.agentId],
    );
    isActive = agent.rows[0]?.is_active ?? undefined;
  }

  const now = Date.now();
  const lastCheck = session.lastActiveCheck;
  if (!lastCheck || now - lastCheck > ACTIVE_RECHECK_TTL_MS) {
    try {
      const fresh = await getPool().query<{ is_active: boolean | null }>(
        'SELECT is_active FROM agents WHERE id = $1',
        [session.agentId],
      );
      const freshActive = fresh.rows[0]?.is_active;
      if (freshActive === false) {
        await destroySession(sid);
        return { kind: 'deactivated' };
      }
      if (freshActive !== undefined && freshActive !== null) {
        isActive = freshActive;
        session.isActive = freshActive;
      }
      session.lastActiveCheck = now;
      await writeSession(sid, session);
    } catch (err) {
      // Fail OPEN — never block requests due to a transient DB error
      // (matches server/middleware/auth.ts:111).
      logger.error(
        { agentId: session.agentId, err: (err as Error)?.message },
        'auth recheck failed',
      );
    }
  }

  if (isActive === false) {
    await destroySession(sid);
    return { kind: 'deactivated' };
  }

  const auth: AuthContext = {
    companyId: cid,
    agentId: Number(session.agentId),
    role: String(session.role ?? ''),
    agentName: String(session.agentName ?? ''),
    // Past the explicit `isActive === false` rejection above, isActive is
    // either true or undefined; both are "active" per auth.ts:77 ("treat a
    // missing/unresolvable value as active").
    isActive: true,
  };

  if (!isTrialExempt(path)) {
    try {
      const status = await getCompanyTrialStatus(cid);
      if (status.expired) {
        return {
          kind: 'trial-expired',
          auth,
          trialDays: status.trialDays,
          expiresAt: status.expiresAt,
        };
      }
    } catch {
      return { kind: 'service-unavailable' };
    }
  }

  return { kind: 'authorized', auth };
}
