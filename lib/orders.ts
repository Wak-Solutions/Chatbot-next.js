/**
 * Customer-order lookup by order_number.
 *
 * Extracted from lib/llm/tools.ts (Phase 1 Step 2) so the AI SDK tool
 * definition can import a standalone function. The spec wrote
 * `import { lookupOrder } from '@/lib/orders'`; this file backs that
 * import.
 *
 * Tenant scoping is mandatory: every call MUST pass the calling
 * companyId and the SQL WHERE clause filters on it. The caller (the bot
 * tool factory in lib/llm/tools.ts) sources companyId from the
 * authenticated request context, NOT from any model-supplied value, so
 * a hallucinated company_id can never cross tenants.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('orders');

export interface LookupOrderResult {
  found: boolean;
  message?: string;
  order_number?: string;
  status?: string;
  details?: unknown;
  created_at?: string;
}

export async function lookupOrder(
  orderNumber: string,
  companyId: number,
): Promise<LookupOrderResult> {
  try {
    const r = await getPool().query<{
      order_number: string;
      status: string;
      details: unknown;
      created_at: Date;
    }>(
      `SELECT order_number, status, details, created_at
       FROM orders
       WHERE order_number = $1 AND company_id = $2`,
      [orderNumber, companyId],
    );
    const row = r.rows[0];
    if (!row) {
      logger.info({ orderNumber }, 'Order not found');
      return { found: false, message: `No order found with number ${orderNumber}.` };
    }
    logger.info({ orderNumber, status: row.status }, 'Order lookup success');
    return {
      found: true,
      order_number: row.order_number,
      status: row.status,
      details: row.details,
      created_at: String(row.created_at),
    };
  } catch (err) {
    logger.error(
      { orderNumber, err: (err as Error)?.message },
      'lookup_order failed',
    );
    throw err;
  }
}
