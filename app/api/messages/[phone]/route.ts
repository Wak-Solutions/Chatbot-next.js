/**
 * GET /api/messages/:phone — port of server/routes/messages.routes.ts:32-51.
 *
 * Tenant-scoped conversation history. Phone format is validated
 * (^\+?[0-9]{7,15}$) before the SQL runs.
 *
 * Rate limit: 30 req / min keyed on agentId. The original server uses
 * express-rate-limit with the same shape; this module instantiates a
 * createRateLimiter directly so the limiter state lives with the route.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { createRateLimiter } from '@/lib/http/rateLimit';

const logger = createLogger('messages');

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
const messagesLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ params: Promise<{ phone: string }> }>(
  async (_request, auth, ctx) => {
    const { phone } = await ctx.params;
    if (!PHONE_PATTERN.test(phone)) {
      return NextResponse.json({ message: 'Invalid phone number format' }, { status: 400 });
    }

    const decision = messagesLimiter.check(`msgs:${auth.agentId}`);
    if (!decision.ok) {
      return NextResponse.json(
        { message: 'Too many requests' },
        {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
        },
      );
    }

    try {
      const result = await getPool().query(
        `SELECT * FROM messages
         WHERE customer_phone = $1 AND company_id = $2
         ORDER BY created_at ASC`,
        [phone, auth.companyId],
      );
      return NextResponse.json(result.rows);
    } catch (err) {
      logger.error(
        { phone: maskPhone(phone), err: (err as Error)?.message },
        'getMessages failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  },
);
