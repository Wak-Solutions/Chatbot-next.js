/**
 * Subscription plan catalogue — provider-agnostic.
 *
 * Three monthly tiers billed in SAR, each with a chat + message quota.
 * "chats"   = distinct customers (customer_phone) the bot served this period.
 * "messages"= total rows in `messages` for the company this period.
 *
 * Prices are the human SAR amount (e.g. 50.00). The payment provider adapter
 * is responsible for formatting to the gateway's expected decimal precision.
 * Nothing in here references Tap — swapping providers does not touch this file.
 */

export type PlanId = 'starter' | 'growth' | 'pro';

export interface Plan {
  id: PlanId;
  /** Human label shown in UI. */
  name: string;
  /** Monthly price in SAR (major units, 2 decimals at the gateway). */
  price: number;
  currency: 'SAR';
  /** Distinct customers per billing period. */
  chats: number;
  /** Total messages per billing period. */
  messages: number;
}

export const PLANS: Record<PlanId, Plan> = {
  starter: { id: 'starter', name: 'Starter', price: 50, currency: 'SAR', chats: 300, messages: 3000 },
  growth: { id: 'growth', name: 'Growth', price: 150, currency: 'SAR', chats: 1200, messages: 12000 },
  pro: { id: 'pro', name: 'Pro', price: 300, currency: 'SAR', chats: 3000, messages: 30000 },
};

/** Ordered cheapest → most expensive, for rendering plan cards. */
export const PLAN_ORDER: PlanId[] = ['starter', 'growth', 'pro'];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS;
}

export function getPlan(id: PlanId): Plan {
  return PLANS[id];
}
