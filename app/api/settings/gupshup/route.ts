/**
 * GET/PUT /api/settings/gupshup — per-company Gupshup (WhatsApp BSP) creds.
 *
 * Mirrors /api/settings/whatsapp: admin-only, CSRF-guarded, scoped to the
 * caller's company. Writes the three columns the worker reads via
 * getGupshupCreds: gupshup_app_name, gupshup_api_key, gupshup_source_number.
 *
 * Masked-value passthrough: the GET response masks the API key; a PUT value
 * containing '*' is treated as "unchanged" and that column is skipped — so
 * re-saving the form without re-typing the key never wipes it.
 *
 * The Gupshup webhook auth (GUPSHUP_WEBHOOK_TOKEN) is intentionally NOT here:
 * it's a single deploy-level secret the worker checks BEFORE it knows the
 * company, so it lives in env, not per-company config.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('settings-gupshup');

export const dynamic = 'force-dynamic';

function maskSecret(value: string | null): string {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

export const GET = withAdmin(async (_request, auth) => {
  try {
    const r = await getPool().query<{
      gupshup_app_name: string | null;
      gupshup_api_key: string | null;
      gupshup_source_number: string | null;
    }>(
      `SELECT gupshup_app_name, gupshup_api_key, gupshup_source_number
       FROM companies WHERE id = $1`,
      [auth.companyId],
    );
    const row = r.rows[0];
    return NextResponse.json({
      appName: row?.gupshup_app_name ?? '',
      sourceNumber: row?.gupshup_source_number ?? '',
      apiKey: maskSecret(row?.gupshup_api_key ?? null),
    });
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, err: (err as Error)?.message },
      'getGupshupSettings failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});

const appNameSchema = z.coerce.string().min(1).max(128);
const sourceSchema = z.coerce.string().min(1).max(32);
const apiKeySchema = z.coerce.string().max(256);

export const PUT = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const body = ((await request.json()) ?? {}) as {
        appName?: string;
        sourceNumber?: string;
        apiKey?: string;
      };
      const { appName, sourceNumber, apiKey } = body;

      if (!appName || !sourceNumber) {
        return NextResponse.json(
          { message: 'appName and sourceNumber are required' },
          { status: 400 },
        );
      }
      if (!appNameSchema.safeParse(appName).success) {
        return NextResponse.json({ message: 'appName is too long' }, { status: 400 });
      }
      if (!sourceSchema.safeParse(sourceNumber).success) {
        return NextResponse.json({ message: 'sourceNumber is invalid' }, { status: 400 });
      }
      if (apiKey && !apiKeySchema.safeParse(apiKey).success) {
        return NextResponse.json({ message: 'apiKey is too long' }, { status: 400 });
      }

      const isMasked = (v: string) => v.includes('*');

      const setClauses: string[] = ['gupshup_app_name = $1', 'gupshup_source_number = $2'];
      const params: unknown[] = [String(appName).trim(), String(sourceNumber).trim()];
      let idx = 3;

      if (apiKey !== undefined && apiKey !== null && apiKey !== '') {
        const keyStr = String(apiKey).trim();
        if (!isMasked(keyStr)) {
          setClauses.push(`gupshup_api_key = $${idx++}`);
          params.push(keyStr);
        }
      }

      params.push(auth.companyId);
      await getPool().query(
        `UPDATE companies SET ${setClauses.join(', ')} WHERE id = $${idx}`,
        params,
      );

      logger.info({ companyId: auth.companyId, appName }, 'setGupshupSettings');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'setGupshupSettings failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
