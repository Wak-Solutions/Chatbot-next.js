/**
 * POST /api/auth/reset-password — port of server/routes/auth.routes.ts:558-603.
 *
 * Public, rate-limited (authResetLimiter — 10 / 15 min / IP). Consumes a
 * reset token (matched by SHA-256 hash) and sets a new password. Timing
 * is normalized via a dummy bcrypt compare on the "not found" and
 * "expired/used" paths so token existence cannot be inferred from
 * response latency.
 */

import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { authResetLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('auth');

const TIMING_DUMMY_HASH = '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ipDecision = authResetLimiter.check(`reset:${clientIp(request)}`);
  if (!ipDecision.ok) {
    return NextResponse.json(
      { message: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(ipDecision.retryAfterMs / 1000)) },
      },
    );
  }

  try {
    const body = await request.json();
    const token = typeof body?.token === 'string' ? body.token : '';
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
    if (!token || !newPassword) {
      return NextResponse.json(
        { message: 'Token and new password are required' },
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

    const tokenHash = hashToken(token);
    const r = await getPool().query<{
      id: number;
      agent_id: number;
      expires_at: Date;
      used_at: Date | null;
    }>(
      `SELECT id, agent_id, expires_at, used_at FROM password_resets WHERE token_hash = $1 LIMIT 1`,
      [tokenHash],
    );
    const reset = r.rows[0];
    if (!reset) {
      await bcrypt.compare('dummy', TIMING_DUMMY_HASH);
      return NextResponse.json(
        { message: 'This reset link is invalid or has expired.' },
        { status: 400 },
      );
    }
    if (reset.used_at || new Date(reset.expires_at) < new Date()) {
      await bcrypt.compare('dummy', TIMING_DUMMY_HASH);
      return NextResponse.json(
        { message: 'This reset link is invalid or has expired.' },
        { status: 400 },
      );
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await getPool().query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [reset.id]);
    await getPool().query('UPDATE agents SET password_hash = $1 WHERE id = $2', [
      newHash,
      reset.agent_id,
    ]);

    logger.info({ agentId: reset.agent_id }, 'resetPassword success');
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error(
      { ip: clientIp(request), err: (err as Error)?.message },
      'resetPassword failed',
    );
    return NextResponse.json(
      { message: 'Could not reset password. Please try again.' },
      { status: 500 },
    );
  }
}
