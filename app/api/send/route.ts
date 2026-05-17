/**
 * POST /api/send — port of server/routes/messages.routes.ts:80-166.
 *
 * Authenticated agent send. Hits Meta directly (NOT through the worker),
 * matching the existing behavior, then records the outbound row as
 * sender='agent' in messages with conversation_id reuse:
 *
 *   Within a 24-hour window of any previous message on this
 *   (customer_phone, company_id) tuple, reuse the latest conversation_id.
 *   Outside the window, mint a new uuid via gen_random_uuid().
 *
 * INTENTIONAL BEHAVIOR CHANGE vs original — Added advisory lock vs
 * original — preserves cross-writer consistency once worker is live in
 * PR 13. The SELECT-then-INSERT in messages.routes.ts:142-155 has a
 * TOCTOU race where two concurrent sends to the same customer can mint
 * two different conversation_ids for the same logical session.
 *
 * Today (single writer = Express → soon Next.js) the race is dormant —
 * one event loop serializes the SELECT and the INSERT for any one
 * request. PR 13 introduces a second writer (the worker, which also
 * writes inbound messages with conversation_id), creating a true
 * cross-process race that no event-loop ordering can prevent. Adding
 * the lock now means the worker can lift the same pattern verbatim and
 * the two writers stay consistent.
 *
 * The lock is keyed on `convo:<companyId>:<phone>` via @/lib/db/locks
 * (SHA-256 → bigint, deterministic). It mirrors the inbound advisory-
 * lock pattern already in Chatbot/memory.py:144. Auto-released on
 * transaction commit/rollback. Tracked in docs/migration-divergences.md.
 *
 * On Meta failure we translate the error.code into a user-actionable
 * message (190 → token expired, 131047 → 24h window, 100 → wrong
 * phone-id, 10/200 → missing permissions) and return 502.
 */

import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { maskPhone } from '@/lib/phone';
import { api } from '@/lib/contracts/routes';
import { getWhatsappCreds, invalidateWhatsappCreds } from '@/lib/companies/creds';
import { lockKey } from '@/lib/db/locks';

const logger = createLogger('messages');

export const dynamic = 'force-dynamic';

interface MetaErrorBody {
  error?: { code?: number; message?: string };
}

export const POST = withCsrf(
  withAuth(async (request, auth) => {
    try {
      const data = api.messages.send.input.parse(await request.json());
      const companyId = auth.companyId;
      logger.info(
        { phone: maskPhone(data.customer_phone), type: 'text' },
        'Agent message send requested',
      );

      const creds = await getWhatsappCreds(companyId);
      if (!creds) {
        logger.error({ companyId }, 'Send failed — company missing WhatsApp credentials');
        return NextResponse.json(
          {
            message:
              'WhatsApp credentials not configured for this account. Go to Settings to add them.',
          },
          { status: 503 },
        );
      }

      const metaUrl = `https://graph.facebook.com/v19.0/${creds.phoneId}/messages`;
      const metaRes = await fetch(metaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.token}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: data.customer_phone,
          type: 'text',
          text: { body: data.message },
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!metaRes.ok) {
        const errBody = await metaRes.text().catch(() => '');
        logger.error(
          {
            phone: maskPhone(data.customer_phone),
            status: metaRes.status,
            body: errBody.slice(0, 200),
          },
          'Meta Cloud API send failed',
        );
        let metaCode: number | undefined;
        try {
          metaCode = (JSON.parse(errBody) as MetaErrorBody)?.error?.code;
        } catch {
          // ignore parse failure — metaCode stays undefined
        }
        // Token-related errors → drop the cached creds so the next attempt
        // re-reads the (possibly rotated) values from the DB. Matches the
        // Python remediation comment at Chatbot/_db_creds.py:14.
        if (metaCode === 190 || metaCode === 10 || metaCode === 200) {
          invalidateWhatsappCreds(companyId);
        }
        let userMessage = 'Failed to send message via WhatsApp. Check credentials.';
        if (metaCode === 190) {
          userMessage =
            'WhatsApp access token is invalid or expired. Generate a permanent System User token in Meta Business Manager and update it in Settings.';
        } else if (metaCode === 131047) {
          userMessage =
            'The 24-hour customer service window has expired. The customer must message you first, or you must send an approved template.';
        } else if (metaCode === 100) {
          userMessage =
            'WhatsApp phone number ID is wrong or does not belong to this app. Update it in Settings.';
        } else if (metaCode === 10 || metaCode === 200) {
          userMessage =
            'WhatsApp access token is missing required permissions (whatsapp_business_messaging).';
        }
        return NextResponse.json({ message: userMessage, metaCode }, { status: 502 });
      }

      // Record the outbound row with conversation_id reuse under an
      // advisory lock keyed on (company, phone). See file header for the
      // race this prevents.
      const key = lockKey(`convo:${companyId}:${data.customer_phone}`);
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [key.toString()]);

        const convRes = await client.query<{ conversation_id: string | null }>(
          `SELECT conversation_id FROM messages
           WHERE customer_phone = $1 AND company_id = $2
             AND conversation_id IS NOT NULL
             AND created_at > NOW() - INTERVAL '24 hours'
           ORDER BY created_at DESC LIMIT 1`,
          [data.customer_phone, companyId],
        );
        const conversationId = convRes.rows[0]?.conversation_id ?? null;
        await client.query(
          `INSERT INTO messages (customer_phone, direction, sender, message_text, company_id, created_at, conversation_id)
           VALUES ($1, 'outbound', 'agent', $2, $3, NOW(), COALESCE($4::uuid, gen_random_uuid()))`,
          [data.customer_phone, data.message, companyId, conversationId],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      logger.info(
        { phone: maskPhone(data.customer_phone) },
        'Agent message delivered via Meta Cloud API',
      );
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        {
          companyId: auth.companyId,
          agentId: auth.agentId,
          err: (err as Error)?.message,
        },
        'send failed',
      );
      return NextResponse.json({ message: 'Failed to send message' }, { status: 400 });
    }
  }),
);
