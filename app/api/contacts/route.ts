/**
 * /api/contacts — GET (list) + POST (create).
 * Port of server/routes/customers.routes.ts:273-338.
 *
 * DIVERGENCE: plan says withAuth, original uses requireAdmin. Preserving
 * admin-only. Flagged.
 *
 * POST upsert: ensure the contact row (by phone), then link it to the
 * company via contact_companies. If the link already exists, 409
 * "duplicate".
 */

import { NextResponse } from 'next/server';
import { withAdmin, withCsrf } from '@/lib/http/handlers';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { maskPhone, toMetaPhone } from '@/lib/phone';

const INTL_PHONE_HINT =
  'Enter the number in full international format with country code, exactly as ' +
  'WhatsApp delivers it (e.g. 966501234567 or +966501234567). Local formats ' +
  'like 0501234567 are not accepted.';

const logger = createLogger('contacts');

export const dynamic = 'force-dynamic';

export const GET = withAdmin(async (_request, auth) => {
  try {
    const result = await getPool().query(
      `SELECT c.id, c.phone_number, cc.name, cc.source, cc.created_at
       FROM contacts c
       JOIN contact_companies cc ON cc.contact_id = c.id
       WHERE cc.company_id = $1
       ORDER BY cc.created_at DESC`,
      [auth.companyId],
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    logger.error(
      { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
      'getContacts failed',
    );
    return NextResponse.json({ message: 'Internal error' }, { status: 500 });
  }
});

export const POST = withCsrf(
  withAdmin(async (request, auth) => {
    const body = (await request.json()) as { name?: string; phone_number?: string };
    if (!body.phone_number) {
      return NextResponse.json({ message: 'Phone number is required' }, { status: 400 });
    }
    const phone = toMetaPhone(body.phone_number);
    if (!phone) {
      return NextResponse.json({ message: INTL_PHONE_HINT }, { status: 400 });
    }

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const upsert = await client.query<{ id: number }>(
        `INSERT INTO contacts (phone_number, source)
         VALUES ($1, 'manual')
         ON CONFLICT (phone_number) DO NOTHING
         RETURNING id, phone_number`,
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
         VALUES ($1, $2, 'manual', $3)
         ON CONFLICT (contact_id, company_id) DO NOTHING
         RETURNING source, created_at, name`,
        [contactId, auth.companyId, (body.name || '').trim() || null],
      );
      if ((link.rowCount ?? 0) === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ message: 'duplicate' }, { status: 409 });
      }
      await client.query('COMMIT');
      logger.info({ phone: maskPhone(phone) }, 'Contact created');
      return NextResponse.json({
        id: contactId,
        phone_number: phone,
        name: link.rows[0].name,
        source: link.rows[0].source,
        created_at: link.rows[0].created_at,
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error(
        { companyId: auth.companyId, agentId: auth.agentId, err: (err as Error)?.message },
        'createContact failed',
      );
      return NextResponse.json({ message: 'Internal error' }, { status: 500 });
    } finally {
      client.release();
    }
  }),
);
