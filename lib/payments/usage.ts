/**
 * Usage metering — provider-agnostic.
 *
 *   chats    = distinct customers (customer_phone) served this period.
 *   messages = total rows in `messages` for the company this period.
 *
 * Computed live from the messages table (indexed on company_id, created_at)
 * rather than a counter, so it's always accurate and needs no reset job.
 */

import { getPool } from '@/lib/db/client';
import { getPlan, type Plan, type PlanId } from './plans';

export interface Usage {
  chats: number;
  messages: number;
}

export interface UsageStatus extends Usage {
  plan: Plan;
  chatsRemaining: number;
  messagesRemaining: number;
  overQuota: boolean;
}

export async function getUsage(companyId: number, since: Date): Promise<Usage> {
  const r = await getPool().query<{ chats: string; messages: string }>(
    `SELECT COUNT(DISTINCT customer_phone)::text AS chats, COUNT(*)::text AS messages
       FROM messages
      WHERE company_id = $1 AND created_at >= $2`,
    [companyId, since],
  );
  const row = r.rows[0];
  return { chats: Number(row?.chats ?? 0), messages: Number(row?.messages ?? 0) };
}

export function usageStatus(plan: PlanId, usage: Usage): UsageStatus {
  const p = getPlan(plan);
  const chatsRemaining = Math.max(0, p.chats - usage.chats);
  const messagesRemaining = Math.max(0, p.messages - usage.messages);
  return {
    ...usage,
    plan: p,
    chatsRemaining,
    messagesRemaining,
    overQuota: usage.chats >= p.chats || usage.messages >= p.messages,
  };
}
