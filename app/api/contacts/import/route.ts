/**
 * POST /api/contacts/import — port of server/routes/customers.routes.ts:417-472.
 *
 * Body envelope: { contacts: unknown[] } with array.length ≤ 10_000.
 * Each row is validated imperatively (phone format, name length); invalid
 * rows are counted, not rejected, so a messy CSV still succeeds.
 *
 *   Response: { added, duplicates, invalid }
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

const importBodySchema = z.object({
  contacts: z.array(z.unknown()).max(10_000),
});

export const dynamic = 'force-dynamic';

export const POST = withCsrf(
  withAdmin(async (request, auth) => {
    let rows: unknown[];
    try {
      ({ contacts: rows } = importBodySchema.parse(await request.json()));
    } catch (err) {
      const tooMany = (err as { issues?: { code?: string }[] })?.issues?.some?.(
        (i) => i.code === 'too_big',
      );
      return NextResponse.json(
        { message: tooMany ? 'Import exceeds 10,000 row limit' : 'Invalid payload' },
        { status: 400 },
      );
    }
    const companyId = auth.companyId;
    let added = 0;
    let duplicates = 0;
    let invalid = 0;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      for (const rawRow of rows) {
        const row = (rawRow ?? {}) as { phone?: unknown; name?: unknown };
        const phone = String(row.phone || '').trim().replace(/[\s\-().]/g, '');
        const rawName = String(row.name || '').trim();
        if (rawName.length > 255) {
          invalid++;
          continue;
        }
        const name = rawName.length > 0 ? rawName : null;
        if (!/^\+?\d{7,15}$/.test(phone)) {
          invalid++;
          continue;
        }
        try {
          const upsert = await client.query<{ id: number }>(
            `INSERT INTO contacts (phone_number, source)
             VALUES ($1, 'imported')
             ON CONFLICT (phone_number) DO NOTHING
             RETURNING id`,
            [phone],
          );
          const contactId: number =
            upsert.rows[0]?.id ??
            (await client.query<{ id: number }>(
              `SELECT id FROM contacts WHERE phone_number = $1`,
              [phone],
            )).rows[0].id;
          const link = await client.query(
            `INSERT INTO contact_companies (contact_id, company_id, source, name)
             VALUES ($1, $2, 'imported', $3)
             ON CONFLICT (contact_id, company_id) DO NOTHING
             RETURNING contact_id`,
            [contactId, companyId, name],
          );
          if ((link.rowCount ?? 0) > 0) added++;
          else duplicates++;
        } catch {
          invalid++;
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'importContacts failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    } finally {
      client.release();
    }
    logger.info({ added, duplicates, invalid }, 'Contacts import complete');
    return NextResponse.json({ added, duplicates, invalid });
  }),
);
