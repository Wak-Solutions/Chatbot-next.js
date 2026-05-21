/**
 * Per-request agent.is_active recheck used by the Auth.js session
 * callback. Returns silently when active; throws when deactivated so
 * Auth.js surfaces the error and ends the session.
 *
 * Extracted from the deleted lib/auth/getSession.ts isActive recheck
 * loop. Same SQL, same fail-open behavior on DB errors (legacy parity
 * with server/middleware/auth.ts:111 — never block a request on a
 * transient DB blip).
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('auth-is-active');

export async function recheckIsActive(agentId: number): Promise<void> {
  try {
    const r = await getPool().query<{ is_active: boolean | null }>(
      'SELECT is_active FROM agents WHERE id = $1',
      [agentId],
    );
    const active = r.rows[0]?.is_active;
    if (active === false) {
      throw new Error('Account deactivated');
    }
  } catch (err) {
    // Fail-open on DB errors; only re-throw the explicit deactivation.
    if ((err as Error)?.message === 'Account deactivated') throw err;
    logger.error(
      { agentId, err: (err as Error)?.message },
      'is_active recheck failed (fail-open)',
    );
  }
}
