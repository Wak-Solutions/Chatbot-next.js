/**
 * GET /api/conversations/:phone/state — current AI pause state for the
 * conversation. Used by the dashboard banner + toggle.
 *
 * Response shape:
 *   {
 *     paused: boolean,                       // false when row is missing
 *     paused_at: string | null,              // ISO-8601 or null
 *     paused_by_agent_id: number | null,
 *     expires_at: string | null,             // paused_at + 1h, ISO-8601 or null
 *   }
 *
 * "paused" reflects the effective state: a row with ai_paused=true whose
 * paused_at is older than PAUSE_TTL_MS reports paused=false (matches the
 * worker's read-time auto-expire). companyId is always from auth — the
 * phone is the only path-level input.
 */

import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { getPauseState, isPauseActive, PAUSE_TTL_MS } from '@/lib/conversations/pauseState';

const logger = createLogger('conversation-pause');

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ params: Promise<{ phone: string }> }>(
  async (_request, auth, ctx) => {
    const { phone } = await ctx.params;
    if (!PHONE_PATTERN.test(phone)) {
      return NextResponse.json({ message: 'Invalid phone number format' }, { status: 400 });
    }

    try {
      const row = await getPauseState(phone, auth.companyId);
      const active = isPauseActive(row);
      const pausedAtMs = row?.paused_at ? new Date(row.paused_at).getTime() : null;
      return NextResponse.json({
        paused: active,
        paused_at: active && pausedAtMs ? new Date(pausedAtMs).toISOString() : null,
        paused_by_agent_id: active ? row?.paused_by_agent_id ?? null : null,
        expires_at:
          active && pausedAtMs ? new Date(pausedAtMs + PAUSE_TTL_MS).toISOString() : null,
      });
    } catch (err) {
      logger.error(
        {
          phone: maskPhone(phone),
          companyId: auth.companyId,
          err: (err as Error)?.message,
        },
        'pause state read failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  },
);
