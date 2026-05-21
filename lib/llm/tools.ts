/**
 * AI SDK tool definitions for the bot. Wired into generateText() in
 * worker/orchestrator/getReply.ts.
 *
 * Exported as a FACTORY (botTools(companyId)) rather than a static
 * object. The spec showed `export const botTools = {...}` with a
 * single-arg lookupOrder, but doing that would either:
 *   (a) drop tenant scoping entirely — cross-tenant data leak, or
 *   (b) require the model to supply company_id — insecure (the model
 *       could hallucinate or be prompt-injected into another tenant's
 *       company_id).
 * The factory shape preserves the spec's tool/schema structure while
 * capturing companyId in closure from the authenticated request
 * context, so the LLM never sees or controls it.
 *
 * v6 SDK note: the `tool({ ... })` field is `inputSchema` (not
 * `parameters` — that was the v4 name shown in the spec). The schema
 * itself is unchanged.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { lookupOrder } from '@/lib/orders';
import { createLogger } from '@/lib/logger';

const logger = createLogger('tools');

export function botTools(companyId: number) {
  return {
    lookup_order: tool({
      description:
        'Look up a customer order in the database using the order number. ' +
        'Use this when a customer wants to track or check the status of their order.',
      inputSchema: z.object({
        order_number: z
          .string()
          .describe('The order number provided by the customer, e.g. WAK-001'),
      }),
      execute: async ({ order_number }) => {
        try {
          return await lookupOrder(order_number, companyId);
        } catch (err) {
          logger.error(
            { order_number, err: (err as Error)?.message },
            'lookup_order failed',
          );
          return { error: 'Order lookup temporarily unavailable. Please try again.' };
        }
      },
    }),
  };
}
