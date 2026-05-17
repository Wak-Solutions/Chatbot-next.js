/**
 * GET /api/customers/[phone]/journey — port of server/routes/customers.routes.ts:125-269.
 *
 * Returns a sorted timeline of every interaction on this phone for the
 * current company: messages (collapsed into runs of same-sender),
 * escalations, meetings (booked/completed), survey send/submit, and
 * orders.
 *
 * DIVERGENCE: plan says withAuth, original uses requireAdmin. Preserving
 * admin-only. Flagged.
 */

import { NextResponse } from 'next/server';
import { withAdmin } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';

const logger = createLogger('customers');

const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

export const dynamic = 'force-dynamic';

interface TimelineItem {
  type: string;
  timestamp: Date | string;
  summary: string;
  meta: Record<string, unknown>;
}

export const GET = withAdmin<{ params: Promise<{ phone: string }> }>(
  async (_request, auth, ctx) => {
    const { phone: encoded } = await ctx.params;
    const phone = decodeURIComponent(encoded);
    if (!PHONE_PATTERN.test(phone)) {
      return NextResponse.json({ message: 'Invalid phone number format' }, { status: 400 });
    }
    const companyId = auth.companyId;

    try {
      const [msgRes, escRes, meetRes, survRes, ordRes, contactRes] = await Promise.all([
        getPool().query(
          `SELECT id, direction, sender, message_text, created_at
           FROM messages WHERE customer_phone = $1 AND company_id = $2 ORDER BY created_at ASC`,
          [phone, companyId],
        ),
        getPool().query(
          `SELECT id, escalation_reason, status, assigned_agent_id, created_at
           FROM escalations WHERE customer_phone = $1 AND company_id = $2 ORDER BY created_at ASC`,
          [phone, companyId],
        ),
        getPool().query(
          `SELECT id, status, meeting_link, meeting_token, created_at, scheduled_at
           FROM meetings WHERE customer_phone = $1 AND company_id = $2 ORDER BY created_at ASC`,
          [phone, companyId],
        ),
        getPool().query(
          `SELECT sr.id, sr.submitted, sr.created_at, sr.submitted_at, s.title
           FROM survey_responses sr
           LEFT JOIN surveys s ON s.id = sr.survey_id AND s.company_id = $2
           WHERE sr.customer_phone = $1 AND sr.company_id = $2 ORDER BY sr.created_at ASC`,
          [phone, companyId],
        ),
        getPool().query(
          `SELECT id, order_number, status, details, created_at
           FROM orders WHERE customer_phone = $1 AND company_id = $2 ORDER BY created_at ASC`,
          [phone, companyId],
        ),
        getPool().query(
          `SELECT cc.name, cc.source
           FROM contacts c
           JOIN contact_companies cc ON cc.contact_id = c.id
           WHERE c.phone_number = $1 AND cc.company_id = $2
           LIMIT 1`,
          [phone, companyId],
        ),
      ]);

      const timeline: TimelineItem[] = [];
      const msgs = msgRes.rows;

      if (msgs.length > 0) {
        timeline.push({
          type: 'first_contact',
          timestamp: msgs[0].created_at,
          summary: 'First contact via WhatsApp',
          meta: { message: msgs[0].message_text?.slice(0, 120) },
        });
        let i = 1;
        while (i < msgs.length) {
          const sender = msgs[i].sender;
          const isAgent = sender === 'agent';
          const type = isAgent ? 'agent_message' : 'bot_message';
          let count = 0;
          const start = msgs[i].created_at;
          while (i < msgs.length && msgs[i].sender === sender) {
            count++;
            i++;
          }
          const end = msgs[i - 1].created_at;
          timeline.push({
            type,
            timestamp: start,
            summary: `${count} ${isAgent ? 'agent' : 'bot'} message${count !== 1 ? 's' : ''}`,
            meta: { count, from: start, to: end },
          });
        }
      }

      for (const e of escRes.rows) {
        timeline.push({
          type: 'escalation',
          timestamp: e.created_at,
          summary: e.escalation_reason || 'Escalated to agent',
          meta: { status: e.status, assigned_agent_id: e.assigned_agent_id, reason: e.escalation_reason },
        });
      }
      for (const m of meetRes.rows) {
        timeline.push({
          type: 'meeting_booked',
          timestamp: m.created_at,
          summary: 'Meeting booked',
          meta: { meeting_token: m.meeting_token, status: m.status },
        });
        if (m.status === 'completed' && m.scheduled_at) {
          timeline.push({
            type: 'meeting_completed',
            timestamp: m.scheduled_at,
            summary: 'Meeting completed',
            meta: { meeting_token: m.meeting_token },
          });
        }
      }
      for (const s of survRes.rows) {
        timeline.push({
          type: 'survey_sent',
          timestamp: s.created_at,
          summary: `Survey sent${s.title ? ': ' + s.title : ''}`,
          meta: { survey_title: s.title },
        });
        if (s.submitted && s.submitted_at) {
          timeline.push({
            type: 'survey_submitted',
            timestamp: s.submitted_at,
            summary: `Survey submitted${s.title ? ': ' + s.title : ''}`,
            meta: { survey_title: s.title },
          });
        }
      }
      for (const o of ordRes.rows) {
        timeline.push({
          type: 'order',
          timestamp: o.created_at,
          summary: `Order ${o.order_number} — ${o.status}`,
          meta: { order_number: o.order_number, status: o.status, details: o.details },
        });
      }

      timeline.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      const contact = contactRes.rows[0];
      return NextResponse.json({
        customer: {
          phone,
          name: contact?.name || null,
          source: contact?.source || null,
          firstSeen: msgs[0]?.created_at || null,
        },
        timeline,
      });
    } catch (err) {
      logger.error(
        { phone: maskPhone(phone), err: (err as Error)?.message },
        'getCustomerJourney failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  },
);
