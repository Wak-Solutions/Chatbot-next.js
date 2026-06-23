/**
 * Public type + Zod-insert exports for the dashboard client and worker.
 *
 * Ported from shared/schema.ts during PR 15 cleanup. shared/ is deleted
 * after this. `messages` and `escalations` themselves live in
 * @/lib/db/schema (the Drizzle source of truth); this file just
 * re-exports the inferred row types + insert Zod schemas, plus the
 * client-side `Conversation` interface that is derived from a query
 * join rather than a single table.
 */

import { createInsertSchema } from 'drizzle-zod';
import type { z } from 'zod';
import { messages, escalations } from '@/lib/db/schema';

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  created_at: true,
});
export const insertEscalationSchema = createInsertSchema(escalations).omit({
  id: true,
  created_at: true,
});

export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Escalation = typeof escalations.$inferSelect;
export type InsertEscalation = z.infer<typeof insertEscalationSchema>;

/**
 * Unified conversation view — derived from the messages table joined
 * with the latest escalation status for that customer. Returned by
 * GET /api/conversations.
 */
export interface Conversation {
  customer_phone: string;
  /** Saved contact name for this phone, when one exists; else null. */
  customer_name: string | null;
  last_message: string;
  last_message_at: string | null;
  escalation_status: string | null;
  escalation_reason: string | null;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
}
