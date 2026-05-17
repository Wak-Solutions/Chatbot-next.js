/**
 * PUT /api/settings/branding — port of server/routes/settings.routes.ts:266-283.
 *
 * Updates companies.brand_name. Trimmed; empty → 400.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('settings');

export const dynamic = 'force-dynamic';

export const PUT = withCsrf(
  withAdmin(async (request, auth) => {
    try {
      const body = (await request.json()) as { brandName?: unknown };
      const brandName = typeof body?.brandName === 'string' ? body.brandName.trim() : '';
      if (!brandName) {
        return NextResponse.json({ message: 'brandName is required' }, { status: 400 });
      }
      await getPool().query('UPDATE companies SET brand_name = $1 WHERE id = $2', [
        brandName,
        auth.companyId,
      ]);
      logger.info({ companyId: auth.companyId, brandName }, 'setBranding');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'setBranding failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
