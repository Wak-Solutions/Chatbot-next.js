/**
 * POST /api/billing/renew-checkout — start checkout WITHOUT a session.
 *
 * When a trial expires the user can't log in (auth blocks expired companies),
 * so they can't reach the session-guarded /api/billing/checkout to pay. This
 * public endpoint re-verifies their email + password inline (same bcrypt check
 * as login), confirms they're an admin, and returns a hosted-checkout URL.
 *
 * Rate-limited per IP and returns a generic 401 so it can't be used to probe
 * which accounts exist. No session is created.
 */

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { getDb, getPool } from '@/lib/db/client';
import { agents } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';
import { authEntryLimiter } from '@/lib/http/rateLimit';
import { getPlan, isPlanId } from '@/lib/payments/plans';
import { getActiveProvider } from '@/lib/payments/provider';

const logger = createLogger('billing');

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return request.headers.get('x-real-ip') ?? 'unknown';
}

const INVALID = NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const decision = authEntryLimiter.check(`renew:${clientIp(request)}`);
  if (!decision.ok) {
    return NextResponse.json(
      { message: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) } },
    );
  }

  try {
    const body = ((await request.json()) ?? {}) as {
      email?: string;
      password?: string;
      plan?: string;
    };
    if (!isPlanId(body.plan)) {
      return NextResponse.json({ message: 'Unknown plan' }, { status: 400 });
    }
    if (!body.email || !body.password) return INVALID;

    const db = getDb();
    const agent = await db.query.agents.findFirst({ where: eq(agents.email, String(body.email)) });
    if (!agent?.password_hash) return INVALID;
    const valid = await bcrypt.compare(String(body.password), agent.password_hash);
    if (!valid) return INVALID;
    if (agent.role !== 'admin') {
      return NextResponse.json({ message: 'Only an admin can manage billing' }, { status: 403 });
    }

    const base = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '');
    if (!base) {
      logger.error('DASHBOARD_URL not set — cannot build renew URLs');
      return NextResponse.json({ message: 'Billing is not configured' }, { status: 500 });
    }

    const r = await getPool().query<{
      id: number;
      name: string | null;
      email: string | null;
      phone: string | null;
    }>('SELECT id, name, email, phone FROM companies WHERE id = $1', [agent.company_id]);
    const company = r.rows[0];
    if (!company) return NextResponse.json({ message: 'Company not found' }, { status: 404 });

    const provider = await getActiveProvider();
    const { url } = await provider.createCheckout({
      company,
      plan: getPlan(body.plan),
      redirectUrl: `${base}/login?renewed=1`,
      webhookUrl: `${base}/api/webhooks/${provider.id}`,
    });

    logger.info({ companyId: agent.company_id, plan: body.plan }, 'renew checkout created');
    return NextResponse.json({ url });
  } catch (err) {
    logger.error({ err: (err as Error)?.message }, 'renew checkout failed');
    return NextResponse.json({ message: 'Could not start checkout' }, { status: 502 });
  }
}
