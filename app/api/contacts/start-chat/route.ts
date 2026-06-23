/**
 * POST /api/contacts/start-chat — agent-initiated first message to a contact.
 *
 * WhatsApp only lets a business message a customer first via a PRE-APPROVED
 * TEMPLATE; free-form text is allowed only inside the 24h window that opens
 * after the customer messages. So "start a chat" == "send an approved
 * template".
 *
 * Until a template is configured (WHATSAPP_INITIAL_TEMPLATE) this returns a
 * clear 422 explaining that no template exists yet, so the customer must
 * message first. Once a template is set up and approved by Meta, a successful
 * send persists an outbound message — which makes the conversation appear in
 * the inbox (the conversation list is derived from the messages table).
 *
 * Admin/agent only, CSRF-guarded.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAuth, withCsrf } from '@/lib/http/handlers';
import { createLogger } from '@/lib/logger';
import { toMetaPhone } from '@/lib/phone';
import { sendWhatsAppTemplate } from '@/lib/messaging/whatsapp';
import { saveMessage } from '@/lib/messaging/memory';

const logger = createLogger('start-chat');

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ phone: z.string().min(1) });

const NO_TEMPLATE_MESSAGE =
  'Can’t start a chat yet — no approved WhatsApp template is set up. ' +
  'WhatsApp only lets you message a customer first through a template it has ' +
  'approved; until one exists, the customer has to message you first.';

export const POST = withCsrf(
  withAuth(async (request, auth) => {
    try {
      const parsed = bodySchema.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json({ message: 'A phone number is required.' }, { status: 400 });
      }
      const phone = toMetaPhone(parsed.data.phone);
      if (!phone) {
        return NextResponse.json(
          {
            message:
              'Enter the number in full international format with country code, ' +
              'exactly as WhatsApp delivers it (e.g. 966501234567). Local formats ' +
              'like 0501234567 are not accepted.',
          },
          { status: 400 },
        );
      }

      // The gate: no configured template → we cannot initiate. This is the
      // expected path today and the error says exactly why.
      const templateName = (process.env.WHATSAPP_INITIAL_TEMPLATE ?? '').trim();
      if (!templateName) {
        logger.info({ companyId: auth.companyId }, 'start-chat blocked — no template configured');
        return NextResponse.json({ message: NO_TEMPLATE_MESSAGE }, { status: 422 });
      }
      const languageCode = (process.env.WHATSAPP_INITIAL_TEMPLATE_LANG ?? 'en').trim();

      const sent = await sendWhatsAppTemplate({
        companyId: auth.companyId,
        phone,
        templateName,
        languageCode,
      });
      if (!sent) {
        // Template configured but Meta rejected it (most often: not yet
        // approved, or the name/language don't match an approved template).
        return NextResponse.json(
          {
            message:
              'Couldn’t send the opening template — WhatsApp may not have ' +
              'approved it yet, or its name/language don’t match an approved template.',
          },
          { status: 502 },
        );
      }

      // Real send succeeded → record it so the conversation shows in the inbox.
      await saveMessage({
        customerPhone: phone,
        companyId: auth.companyId,
        direction: 'outbound',
        messageText: `Conversation opened via template "${templateName}"`,
        sender: 'agent',
      });

      logger.info({ companyId: auth.companyId, agentId: auth.agentId }, 'start-chat template sent');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, err: (err as Error)?.message },
        'start-chat failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
