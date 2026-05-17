/**
 * POST /api/contacts/bulk-delete — port of
 * server/routes/customers.routes.ts:382-406.
 *
 * Body: { ids: number[] }. Removes the (contact, company) links for the
 * authed company, then garbage-collects orphaned contacts.
 *
 * DIVERGENCE: plan says withAuth, original uses requireAdmin. Preserving
 * admin-only. Flagged.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('contacts');

const bodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAdmin(async (request, auth) => {
    let ids: number[];
    try {
      ({ ids } = bodySchema.parse(await request.json()));
    } catch {
      return NextResponse.json(
        { message: 'ids must be an array of positive integers' },
        { status: 400 },
      );
    }
    try {
      await getPool().query(
        `DELETE FROM contact_companies WHERE contact_id = ANY($1::int[]) AND company_id = $2`,
        [ids, auth.companyId],
      );
      await getPool().query(
        `DELETE FROM contacts WHERE id = ANY($1::int[])
         AND NOT EXISTS (SELECT 1 FROM contact_companies WHERE contact_id = contacts.id)`,
        [ids],
      );
      logger.info({ count: ids.length }, 'Contacts bulk deleted');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'bulkDeleteContacts failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
