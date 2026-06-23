/**
 * In-process replacement for Chatbot/notifications.notify_dashboard.
 *
 * The legacy Python bot fired POST /api/incoming and POST
 * /api/human-requested at the dashboard for every inbound message and
 * every human-handover signal. PR 13 retires those HTTP hops — the
 * worker calls @/lib/notifications/push directly. Same effects:
 *
 *   event === 'message'           → push "New Chat" to all agents
 *                                   in the company, deduped via the
 *                                   chat_notified table + in-memory
 *                                   notifiedChats Map (PR 7).
 *
 *   event === 'human_requested'   → push "Human Requested" to all
 *                                   agents in the company. No dedup
 *                                   (every request fires; UX expects
 *                                   the alert on every escalation).
 *
 * Per Phase 2 D-1: same observable behavior, no HTTP roundtrip, no
 * x-webhook-secret round-tripped between services that share a DB.
 */

import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { getPool } from '@/lib/db/client';
import { addNotified, hasNotified, notifyAll } from './push';
import { ensureUnclaimedTicket, maybeAutoAssign } from '@/lib/conversations/tickets';

const logger = createLogger('notify-dashboard');

export type DashboardEvent = 'message' | 'human_requested';

export interface NotifyDashboardInput {
  event: DashboardEvent;
  customerPhone: string;
  messageText?: string;
  companyId: number;
}

export async function notifyDashboard(input: NotifyDashboardInput): Promise<void> {
  const { event, customerPhone, companyId } = input;
  try {
    if (event === 'message') {
      // Dedup key matches PR 7's /api/incoming logic: scope to the
      // active conversation_id when there is one, else mint a new-key
      // for this customer.
      let convId: string | null = null;
      try {
        const r = await getPool().query<{ conversation_id: string | null }>(
          `SELECT conversation_id FROM messages
           WHERE customer_phone = $1 AND company_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [customerPhone, companyId],
        );
        convId = r.rows[0]?.conversation_id ?? null;
      } catch (err) {
        logger.error(
          { companyId, err: (err as Error)?.message },
          'notifyDashboard — conversation_id lookup failed (non-fatal)',
        );
      }
      const notifKey = convId
        ? `conv:${convId}`
        : `new:${companyId}:${customerPhone}`;

      if (!(await hasNotified(notifKey))) {
        await addNotified(notifKey);
        await notifyAll(
          {
            title: 'New Chat',
            body: `New conversation from ${maskPhone(customerPhone)}`,
            url: `/dashboard?phone=${encodeURIComponent(customerPhone)}`,
            data: { phone: customerPhone },
          },
          companyId,
        );
      }
      logger.info(
        { event, phone: maskPhone(customerPhone), companyId },
        'Dashboard notified',
      );
      return;
    }

    if (event === 'human_requested') {
      // Create an unclaimed ticket so the chat surfaces in the Unclaimed inbox
      // for an agent to claim. No-op if it already has an active ticket.
      await ensureUnclaimedTicket(customerPhone, companyId, 'customer_requested_agent');
      // If the company is on auto-assign, hand it straight to the least-busy
      // available agent (otherwise it waits in Unclaimed for a manual claim).
      await maybeAutoAssign(customerPhone, companyId);
      await notifyAll(
        {
          title: 'Human Requested',
          body: `${maskPhone(customerPhone)} is requesting a human agent`,
          url: `/dashboard?phone=${encodeURIComponent(customerPhone)}`,
          data: { phone: customerPhone },
        },
        companyId,
      );
      logger.info(
        { event, phone: maskPhone(customerPhone), companyId },
        'Dashboard notified',
      );
      return;
    }

    logger.warn({ event }, 'Unknown event type — notification dropped');
  } catch (err) {
    // Never let a notification failure crash the message flow.
    logger.warn(
      {
        event,
        phone: maskPhone(customerPhone),
        err: (err as Error)?.message,
      },
      'Dashboard notification failed',
    );
  }
}
