/**
 * OpenAI tool definitions + dispatcher for the bot.
 *
 * Port of Chatbot/tools.py + the dispatcher branch from
 * Chatbot/_agent_openai.py:79-96. Currently a single tool:
 * `lookup_order`. Add more by extending TOOLS and the dispatch switch.
 *
 * Dispatcher contract: takes the function name + parsed JSON args +
 * companyId, returns a JSON-stringifiable object the model will receive
 * as the tool_message content. Errors are caught and surfaced as
 * `{ error: '...' }` so a tool failure doesn't abort the bot turn.
 */

import type { ChatCompletionTool } from 'openai/resources/index.mjs';
import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('tools');

export const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_order',
      description:
        'Look up a customer order in the database using the order number. ' +
        'Use this when a customer wants to track or check the status of their order.',
      parameters: {
        type: 'object',
        properties: {
          order_number: {
            type: 'string',
            description: 'The order number provided by the customer, e.g. WAK-001',
          },
        },
        required: ['order_number'],
      },
    },
  },
];

interface LookupOrderResult {
  found: boolean;
  message?: string;
  order_number?: string;
  status?: string;
  details?: unknown;
  created_at?: string;
}

async function lookupOrder(
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

export async function dispatchTool(
  functionName: string,
  args: Record<string, unknown>,
  companyId: number,
): Promise<unknown> {
  if (functionName === 'lookup_order') {
    const orderNumber = String(args.order_number ?? '');
    try {
      return await lookupOrder(orderNumber, companyId);
    } catch {
      // Match the legacy error envelope so the bot can apologise gracefully.
      return { error: 'Order lookup temporarily unavailable. Please try again.' };
    }
  }
  logger.warn({ functionName }, 'Unknown tool requested');
  return { error: `Unknown tool: ${functionName}` };
}
