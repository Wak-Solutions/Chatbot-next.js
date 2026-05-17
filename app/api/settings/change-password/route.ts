/**
 * POST /api/settings/change-password — port of server/routes/settings.routes.ts:297-333.
 *
 * Rate-limited via authChangePasswordLimiter (5/15min, keyed by agentId)
 * to match the legacy threat model: this protects against a
 * compromised-session brute-force on one agent's current password
 * regardless of IP rotation. IP keying would be bypassed by an attacker
 * rotating IPs and would over-restrict agents on shared NAT.
 *
 * Verifies the current password with bcrypt.compare, rejects if
 * mismatched (401) or if new === current (400).
 */

import bcrypt from 'bcrypt';
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { authChangePasswordLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('settings');

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth(async (request, auth) => {
    const decision = authChangePasswordLimiter.check(`cp:${auth.agentId}`);
    if (!decision.ok) {
      return NextResponse.json(
        { message: 'Too many password change attempts. Please try again later.' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
        },
      );
    }
    try {
      const body = ((await request.json()) ?? {}) as {
        currentPassword?: unknown;
        newPassword?: unknown;
      };
      const { currentPassword, newPassword } = body;
      if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
        return NextResponse.json(
          { message: 'currentPassword and newPassword are required' },
          { status: 400 },
        );
      }
      if (newPassword.length < 8) {
        return NextResponse.json(
          { message: 'New password must be at least 8 characters' },
          { status: 400 },
        );
      }
      if (newPassword.length > 128) {
        return NextResponse.json(
          { message: 'New password must be at most 128 characters' },
          { status: 400 },
        );
      }
      if (newPassword === currentPassword) {
        return NextResponse.json(
          { message: 'New password must be different from the current password' },
          { status: 400 },
        );
      }

      const r = await getPool().query<{ password_hash: string }>(
        `SELECT password_hash FROM agents WHERE id = $1`,
        [auth.agentId],
      );
      if (r.rows.length === 0) {
        return NextResponse.json({ message: 'Account not found' }, { status: 404 });
      }
      const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
      if (!ok) {
        logger.warn({ agentId: auth.agentId }, 'changePassword — current password mismatch');
        return NextResponse.json({ message: 'Current password is incorrect' }, { status: 401 });
      }

      const newHash = await bcrypt.hash(newPassword, 10);
      await getPool().query('UPDATE agents SET password_hash = $1 WHERE id = $2', [
        newHash,
        auth.agentId,
      ]);
      logger.info({ agentId: auth.agentId }, 'changePassword success');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'changePassword failed',
      );
      return NextResponse.json({ message: 'Failed to change password' }, { status: 500 });
    }
  }),
);
