/**
 * POST /api/auth/forgot-password — port of server/routes/auth.routes.ts:489-555.
 *
 * Public, rate-limited (authForgotLimiter — 5 / 15 min / IP). Always
 * responds 200 with a generic message regardless of whether the account
 * exists, so the endpoint cannot be used to enumerate users.
 *
 * Token is SHA-256 hashed before storage so a DB leak does not expose
 * usable reset links. Any prior unused tokens for the same account are
 * marked used to keep exactly one live reset link at a time.
 */

import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { authForgotLimiter } from '@/lib/http/rateLimit';
import { sendEmail, esc, getCompanyBranding } from '@/lib/notifications/email';

const logger = createLogger('auth');

const RESET_TTL_MINUTES = 30;
const GENERIC = {
  success: true,
  message: 'If an account exists for that email or phone, a reset link has been sent.',
};

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  // Trust the RIGHTMOST X-Forwarded-For value. Railway terminates TLS at
  // exactly one proxy hop before the container, so the real client IP is
  // appended at the right end of the chain. Values on the left are
  // attacker-controlled — taking the leftmost lets a single client rotate
  // the key per request and defeat per-IP rate limits.
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getAppBaseUrl(): string {
  const trusted =
    process.env.APP_URL ||
    process.env.RAILWAY_PUBLIC_URL ||
    process.env.RAILWAY_PUBLIC_DOMAIN;
  if (!trusted) {
    logger.warn(
      'getAppBaseUrl — no APP_URL/RAILWAY_PUBLIC_URL/RAILWAY_PUBLIC_DOMAIN set; password-reset links will use localhost',
    );
    return 'http://localhost:5000';
  }
  const stripped = trusted.replace(/\/$/, '');
  return stripped.startsWith('http') ? stripped : `https://${stripped}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ipDecision = authForgotLimiter.check(`forgot:${clientIp(request)}`);
  if (!ipDecision.ok) {
    return NextResponse.json(
      { message: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil(ipDecision.retryAfterMs / 1000)) },
      },
    );
  }

  let identifier = '';
  try {
    const body = await request.json();
    if (typeof body?.identifier === 'string') identifier = body.identifier.trim();
  } catch {
    // fall through — empty identifier triggers the 400 below
  }
  if (!identifier) {
    return NextResponse.json({ message: 'Email or phone is required' }, { status: 400 });
  }

  try {
    const agentRes = await getPool().query<{
      id: number;
      name: string | null;
      email: string | null;
      is_active: boolean | null;
      company_id: number | null;
    }>(
      `SELECT id, name, email, is_active, company_id FROM agents
       WHERE lower(email) = lower($1) OR phone = $1 LIMIT 1`,
      [identifier],
    );
    const agent = agentRes.rows[0];
    if (!agent || !agent.is_active || !agent.email) {
      logger.info(
        { identifier: identifier.slice(0, 3) + '***' },
        'forgotPassword — no actionable account',
      );
      return NextResponse.json(GENERIC);
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

    await getPool().query(
      `UPDATE password_resets SET used_at = NOW()
       WHERE agent_id = $1 AND used_at IS NULL`,
      [agent.id],
    );
    await getPool().query(
      `INSERT INTO password_resets (agent_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [agent.id, tokenHash, expiresAt],
    );

    const { brandName } = await getCompanyBranding(agent.company_id ?? 0);
    const resetUrl = `${getAppBaseUrl()}/reset-password/${rawToken}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;padding:32px 16px;">
        <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">
          <div style="background:#0F510F;padding:22px 28px;">
            <h1 style="margin:0;color:#fff;font-size:20px;">${esc(brandName)}</h1>
            <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Password reset</p>
          </div>
          <div style="padding:28px;color:#333;font-size:14px;line-height:1.6;">
            <p>Hi ${esc(agent.name) || 'there'},</p>
            <p>We received a request to reset the password for your ${esc(brandName)} account. Click the button below to choose a new password. This link is valid for ${RESET_TTL_MINUTES} minutes and can only be used once.</p>
            <p style="text-align:center;margin:28px 0;">
              <a href="${resetUrl}" style="background:#0F510F;color:#fff;text-decoration:none;padding:12px 26px;border-radius:8px;font-weight:600;display:inline-block;">Reset Password</a>
            </p>
            <p style="font-size:12px;color:#666;">If the button does not work, copy and paste this link into your browser:<br /><span style="word-break:break-all;color:#0F510F;">${resetUrl}</span></p>
            <p style="font-size:12px;color:#666;margin-top:20px;">If you did not request a password reset you can safely ignore this email — your password will not change.</p>
          </div>
        </div>
      </div>
    `;
    sendEmail(agent.email, `Reset your ${brandName} password`, html).catch((e: unknown) =>
      logger.error({ err: (e as Error)?.message }, 'forgotPassword — email send failed'),
    );

    logger.info({ agentId: agent.id }, 'forgotPassword — reset email dispatched');
    return NextResponse.json(GENERIC);
  } catch (err) {
    logger.error(
      {
        identifier: identifier ? identifier.slice(0, 3) + '***' : '(none)',
        err: (err as Error)?.message,
      },
      'forgotPassword failed',
    );
    return NextResponse.json(GENERIC);
  }
}
