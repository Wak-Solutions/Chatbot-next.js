/**
 * POST /api/notifications/mark-read/:phone — port of
 * server/routes/messages.routes.ts:244-258.
 *
 * Clears the "already-notified" dedup entries for a customer so the next
 * inbound message can fire a "New Chat" push notification again.
 *
 * The legacy server clears both an in-process Map (server/push.ts) and
 * the chat_notified table. The Next.js process is independent — its
 * memory is not shared with the Express process — so this port deletes
 * the persistent rows only. Once Express is decommissioned the in-memory
 * cache disappears with it; the chat_notified rows are the only state
 * that survives a restart, so removing them is sufficient.
 *
 * Tenant-scoping comes from AuthContext.companyId — the path param
 * supplies only the phone identifier.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';

const logger = createLogger('notifications');

export const dynamic = 'force-dynamic';

export const POST = withCsrf<{ params: Promise<{ phone: string }> }>(
  withAuth<{ params: Promise<{ phone: string }> }>(async (_request, auth, ctx) => {
    const { phone: encoded } = await ctx.params;
    const phone = decodeURIComponent(encoded);
    const companyId = auth.companyId;

    let convIds: string[] = [];
    try {
      const r = await getPool().query<{ conversation_id: string | null }>(
        `SELECT DISTINCT conversation_id FROM messages
         WHERE customer_phone = $1 AND company_id = $2 AND conversation_id IS NOT NULL`,
        [phone, companyId],
      );
      convIds = r.rows
        .map((row) => row.conversation_id)
        .filter((v): v is string => typeof v === 'string');
    } catch (err) {
      logger.error(
        { phone: maskPhone(phone), err: (err as Error)?.message },
        'mark-read: conversation_id lookup failed',
      );
    }

    const keys = convIds.map((cid) => `conv:${cid}`).concat([`new:${companyId}:${phone}`]);
    if (keys.length > 0) {
      try {
        await getPool().query('DELETE FROM chat_notified WHERE key = ANY($1::text[])', [keys]);
      } catch (err) {
        logger.error(
          { phone: maskPhone(phone), err: (err as Error)?.message },
          'mark-read: chat_notified delete failed',
        );
      }
    }

    return NextResponse.json({ success: true });
  }),
);
