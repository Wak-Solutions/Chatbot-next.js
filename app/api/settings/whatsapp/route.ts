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

/**
 * Mask a sensitive credential for the GET response. Keeps the first 4
 * and last 4 characters visible so an admin can recognise which value
 * is set, replaces the middle with asterisks. The PUT handler's
 * masked-value passthrough (`isMasked = v.includes('*')`) treats any
 * value containing '*' as "unchanged" and skips updating that column.
 */
function maskSecret(value: string | null): string {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

export const GET = withAdmin(async (_request, auth) => {
  try {
    const r = await getPool().query<{
      whatsapp_phone_number_id: string | null;
      whatsapp_waba_id: string | null;
      whatsapp_token: string | null;
      whatsapp_app_secret: string | null;
    }>(
      `SELECT whatsapp_phone_number_id, whatsapp_waba_id,
              whatsapp_token, whatsapp_app_secret
       FROM companies WHERE id = $1`,
      [auth.companyId],
    );
    const row = r.rows[0];
    return NextResponse.json({
      phoneNumberId: row?.whatsapp_phone_number_id ?? '',
      wabaId: row?.whatsapp_waba_id ?? '',
      accessToken: maskSecret(row?.whatsapp_token ?? null),
      appSecret: maskSecret(row?.whatsapp_app_secret ?? null),
    });
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, err: (err as Error)?.message },
      'getWhatsAppSettings failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});

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
