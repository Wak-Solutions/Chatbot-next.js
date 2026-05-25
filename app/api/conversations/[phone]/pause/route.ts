/**
 * POST /api/conversations/:phone/pause — toggle the per-conversation AI pause.
 *
 * Body: { paused: boolean }.
 *
 * State transitions:
 *   false → true  (activation):
 *     UPSERT ai_paused = true, paused_at = now(), paused_by_agent_id = agent.
 *     Then send the customer the one-time CONNECTING_TO_AGENT WhatsApp
 *     message (FAIL-OPEN — a send failure is logged as warn but the state
 *     write and 200 response still happen).
 *   true → true   (re-activation, e.g. quick off→on):
 *     Same as above. The DB state machine treats this as a fresh
 *     activation (paused_at resets, message resends).
 *   * → false     (deactivation):
 *     UPSERT ai_paused = false, paused_at = null, paused_by_agent_id = null.
 *     NO WhatsApp message.
 *
 * companyId is always from auth.companyId — body cannot influence tenancy.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { sendWhatsAppText } from '@/lib/messaging/whatsapp';
import { saveMessage } from '@/lib/messaging/memory';
import { CONNECTING_TO_AGENT } from '@/lib/messaging/strings';

const logger = createLogger('conversation-pause');

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAuth<{ params: Promise<{ phone: string }> }>(async (request, auth, ctx) => {
    const { phone } = await ctx.params;
    if (!PHONE_PATTERN.test(phone)) {
      return NextResponse.json({ message: 'Invalid phone number format' }, { status: 400 });
    }

    let body: { paused?: unknown };
    try {
      body = (await request.json()) as { paused?: unknown };
    } catch {
      return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
    }
    if (typeof body.paused !== 'boolean') {
      return NextResponse.json({ message: 'Body must include { paused: boolean }' }, { status: 400 });
    }
    const nextPaused = body.paused;

    try {
      if (nextPaused) {
        await getPool().query(
          `INSERT INTO conversation_ai_state
             (customer_phone, company_id, ai_paused, paused_at, paused_by_agent_id, updated_at)
           VALUES ($1, $2, true, NOW(), $3, NOW())
           ON CONFLICT (customer_phone, company_id) DO UPDATE
             SET ai_paused = true,
                 paused_at = NOW(),
                 paused_by_agent_id = $3,
                 updated_at = NOW()`,
          [phone, auth.companyId, auth.agentId],
        );
      } else {
        await getPool().query(
          `INSERT INTO conversation_ai_state
             (customer_phone, company_id, ai_paused, paused_at, paused_by_agent_id, updated_at)
           VALUES ($1, $2, false, NULL, NULL, NOW())
           ON CONFLICT (customer_phone, company_id) DO UPDATE
             SET ai_paused = false,
                 paused_at = NULL,
                 paused_by_agent_id = NULL,
                 updated_at = NOW()`,
          [phone, auth.companyId],
        );
      }
    } catch (err) {
      logger.error(
        {
          phone: maskPhone(phone),
          companyId: auth.companyId,
          err: (err as Error)?.message,
        },
        'pause state write failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }

    if (nextPaused) {
      // FAIL-OPEN: WhatsApp/persistence failures must not roll back the
      // pause state — the agent has already taken control of the
      // conversation, and an outage of either dependency should not block
      // that. Errors are logged at warn level for observability.
      try {
        const sent = await sendWhatsAppText({
          companyId: auth.companyId,
          phone,
          body: CONNECTING_TO_AGENT,
        });
        if (!sent) {
          logger.warn(
            { phone: maskPhone(phone), companyId: auth.companyId },
            'CONNECTING_TO_AGENT WhatsApp send returned false — pause state still applied',
          );
        }
      } catch (err) {
        logger.warn(
          {
            phone: maskPhone(phone),
            companyId: auth.companyId,
            err: (err as Error)?.message,
          },
          'CONNECTING_TO_AGENT WhatsApp send threw — pause state still applied',
        );
      }
      try {
        await saveMessage({
          customerPhone: phone,
          companyId: auth.companyId,
          direction: 'outbound',
          messageText: CONNECTING_TO_AGENT,
          sender: 'ai',
        });
      } catch (err) {
        logger.warn(
          {
            phone: maskPhone(phone),
            companyId: auth.companyId,
            err: (err as Error)?.message,
          },
          'CONNECTING_TO_AGENT save failed — pause state still applied',
        );
      }
    }

    logger.info(
      {
        phone: maskPhone(phone),
        companyId: auth.companyId,
        agentId: auth.agentId,
        paused: nextPaused,
      },
      'pause state updated',
    );
    return NextResponse.json({ success: true, paused: nextPaused });
  }),
);
