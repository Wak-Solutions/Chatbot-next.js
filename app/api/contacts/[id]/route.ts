/**
 * /api/contacts/[id] — PATCH (update name) + DELETE.
 * Port of server/routes/customers.routes.ts:340-380.
 *
 * DIVERGENCE: plan says withAuth + says PUT for update; original uses
 * requireAdmin + PATCH. Preserving admin-only + PATCH. Flagged.
 *
 * DELETE removes the (contact, company) link, then deletes the contact
 * itself if no companies link to it anymore.
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('contacts');

export const dynamic = 'force-dynamic';

export const PATCH = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (request, auth, ctx) => {
    const { id: idStr } = await ctx.params;
    const id = Number(idStr);
    const body = (await request.json()) as { name?: string };
    try {
      const result = await getPool().query(
        `UPDATE contact_companies cc SET name = $1
         FROM contacts c
         WHERE cc.contact_id = c.id AND c.id = $2 AND cc.company_id = $3
         RETURNING c.id, c.phone_number, cc.name, cc.source, cc.created_at`,
        [(body.name || '').trim() || null, id, auth.companyId],
      );
      if ((result.rowCount ?? 0) === 0) {
        return NextResponse.json({ message: 'Not found' }, { status: 404 });
      }
      return NextResponse.json(result.rows[0]);
    } catch (err) {
      logger.error({ contactId: id, err: (err as Error)?.message }, 'updateContact failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);

export const DELETE = withCsrf(
  withAdmin<{ params: Promise<{ id: string }> }>(async (_request, auth, ctx) => {
    const { id: idStr } = await ctx.params;
    const id = Number(idStr);
    try {
      const link = await getPool().query(
        `DELETE FROM contact_companies WHERE contact_id = $1 AND company_id = $2 RETURNING contact_id`,
        [id, auth.companyId],
      );
      if ((link.rowCount ?? 0) === 0) {
        return NextResponse.json({ message: 'Contact not found' }, { status: 404 });
      }
      await getPool().query(
        `DELETE FROM contacts WHERE id = $1
         AND NOT EXISTS (SELECT 1 FROM contact_companies WHERE contact_id = $1)`,
        [id],
      );
      logger.info({ contactId: id }, 'Contact deleted');
      return NextResponse.json({ success: true });
    } catch (err) {
      logger.error({ contactId: id, err: (err as Error)?.message }, 'deleteContact failed');
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    }
  }),
);
