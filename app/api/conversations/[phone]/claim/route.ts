/**
 * POST /api/conversations/:phone/claim — an agent takes a conversation.
 *
 * Assigns the chat's ticket to the agent (creating one if it was claimed
 * straight from the Shared inbox) and pauses the AI so the agent and bot don't
 * both reply. The agent can flip the AI back on with the existing pause toggle;
 * resolving the chat resumes it.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { claimTicket } from '@/lib/conversations/tickets';
import { setAiPaused } from '@/lib/conversations/pauseState';

const logger = createLogger('conversation-claim');

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth<{ params: Promise<{ phone: string }> }>(async (_request, auth, ctx) => {
    const { phone } = await ctx.params;
    if (!PHONE_PATTERN.test(phone)) {
      return NextResponse.json({ message: 'Invalid phone number format' }, { status: 400 });
    }
    try {
      await claimTicket(phone, auth.companyId, auth.agentId);
      await setAiPaused(phone, auth.companyId, auth.agentId, true);
      logger.info(
        { phone: maskPhone(phone), companyId: auth.companyId, agentId: auth.agentId },
        'conversation claimed',
      );
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { phone: maskPhone(phone), companyId: auth.companyId, err: (err as Error)?.message },
        'claim failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
