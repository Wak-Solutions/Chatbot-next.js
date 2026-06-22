/**
 * Usage enforcement.
 *
 * Default is a SOFT cap: usage is metered and surfaced in the dashboard, but
 * a live bot is never silenced mid-period for hitting a quota (silently
 * dropping a business's customer-service replies is worse than an overage).
 *
 * Set USAGE_HARD_CAP=true to actually stop replying once a plan's chat or
 * message quota is reached. Only companies on an active paid plan are subject
 * to the cap; trial access is governed separately by the trial gate.
 */

import { createLogger } from '@/lib/logger';
import { isPlanId } from './plans';
import { getSubscription, periodStart } from './subscription';
import { getUsage, usageStatus } from './usage';

const logger = createLogger('usage-enforcement');

export async function isQuotaExceeded(companyId: number): Promise<boolean> {
  const sub = await getSubscription(companyId);
  if (!sub || sub.status === 'canceled' || !isPlanId(sub.plan)) return false;
  const start = await periodStart(companyId);
  const usage = await getUsage(companyId, start);
  return usageStatus(sub.plan, usage).overQuota;
}

/** Whether the bot should stop replying for this company right now. */
export async function shouldBlockReply(companyId: number): Promise<boolean> {
  if (process.env.USAGE_HARD_CAP !== 'true') return false;
  const exceeded = await isQuotaExceeded(companyId);
  if (exceeded) logger.warn({ companyId }, 'reply blocked — plan quota exceeded');
  return exceeded;
}
