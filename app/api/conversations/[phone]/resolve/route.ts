/**
 * POST /api/conversations/:phone/resolve — close a conversation.
 *
 * Marks the chat's active ticket(s) resolved (moves it to the Resolved inbox)
 * and un-pauses the AI so the bot handles the customer again on their next
 * message.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { resolveTicket } from '@/lib/conversations/tickets';
import { setAiPaused } from '@/lib/conversations/pauseState';

const logger = createLogger('conversation-resolve');

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth<{ params: Promise<{ phone: string }> }>(async (_request, auth, ctx) => {
    const { phone } = await ctx.params;
    if (!PHONE_PATTERN.test(phone)) {
      return NextResponse.json({ message: 'Invalid phone number format' }, { status: 400 });
    }
    try {
      await resolveTicket(phone, auth.companyId);
      await setAiPaused(phone, auth.companyId, auth.agentId, false);
      logger.info(
        { phone: maskPhone(phone), companyId: auth.companyId, agentId: auth.agentId },
        'conversation resolved',
      );
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { phone: maskPhone(phone), companyId: auth.companyId, err: (err as Error)?.message },
        'resolve failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
