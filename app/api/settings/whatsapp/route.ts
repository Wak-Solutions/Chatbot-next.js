/**
 * PUT /api/settings/whatsapp — port of server/routes/settings.routes.ts:187-247.
 *
 * Masked-value passthrough: a value containing '*' came from the
 * masked GET response — treat as "unchanged" and skip updating that
 * column. Preserves the round-trip semantics the dashboard depends on.
 *
 * Hard req #7 — invalidate any in-process creds cache after update.
 * Per PR 7's correction to lib/companies/creds.ts there is no cache to
 * invalidate today (the function is a no-op kept for caller compat).
 * Call it anyway so a future reintroduction is wired automatically.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { invalidateWhatsappCreds } from '@/lib/companies/creds';

const logger = createLogger('settings');

const phoneIdSchema = z.coerce.string().min(1).max(64);
const wabaIdSchema = z.coerce.string().min(1).max(64);
const tokenSchema = z.coerce.string().min(1).max(512);
const secretSchema = z.coerce.string().max(128);

export const dynamic = 'force-dynamic';

export const PUT = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const body = ((await request.json()) ?? {}) as {
        phoneNumberId?: string;
        wabaId?: string;
        accessToken?: string;
        appSecret?: string;
      };
      const { phoneNumberId, wabaId, accessToken, appSecret } = body;

      if (!phoneNumberId || !wabaId || !accessToken) {
        return NextResponse.json(
          { message: 'phoneNumberId, wabaId, and accessToken are required' },
          { status: 400 },
        );
      }
      if (!phoneIdSchema.safeParse(phoneNumberId).success) {
        return NextResponse.json({ message: 'phoneNumberId is too long' }, { status: 400 });
      }
      if (!wabaIdSchema.safeParse(wabaId).success) {
        return NextResponse.json({ message: 'wabaId is too long' }, { status: 400 });
      }
      if (!tokenSchema.safeParse(accessToken).success) {
        return NextResponse.json({ message: 'accessToken is too long' }, { status: 400 });
      }
      if (appSecret && !secretSchema.safeParse(appSecret).success) {
        return NextResponse.json({ message: 'appSecret is too long' }, { status: 400 });
      }

      const isMasked = (v: string) => v.includes('*');

      const setClauses: string[] = ['whatsapp_phone_number_id = $1', 'whatsapp_waba_id = $2'];
      const params: unknown[] = [String(phoneNumberId).trim(), String(wabaId).trim()];
      let idx = 3;

      const tokenStr = String(accessToken).trim();
      if (!isMasked(tokenStr)) {
        setClauses.push(`whatsapp_token = $${idx++}`);
        params.push(tokenStr);
      }
      if (appSecret !== undefined && appSecret !== null && appSecret !== '') {
        const secretStr = String(appSecret).trim();
        if (!isMasked(secretStr)) {
          setClauses.push(`whatsapp_app_secret = $${idx++}`);
          params.push(secretStr);
        }
      }

      params.push(auth.companyId);
      await getPool().query(
        `UPDATE companies SET ${setClauses.join(', ')} WHERE id = $${idx}`,
        params,
      );

      // No-op today (PR 7 dropped the creds cache). Kept so a future cache
      // reintroduction is automatically invalidated on credential change.
      invalidateWhatsappCreds(auth.companyId);

      logger.info({ companyId: auth.companyId, phoneNumberId }, 'setWhatsAppSettings');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'setWhatsAppSettings failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
