/**
 * Subscription state — provider-agnostic DB layer over payment_subscriptions.
 *
 * companies.subscription_ends_at remains the access source of truth (the
 * trial gate reads it); this table is the billing engine's bookkeeping:
 * which plan, the vaulted card refs, and when the next charge is due.
 *
 * applyCapturedCharge is idempotent on charge id so a webhook redelivery
 * never double-extends access.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { getPlan, isPlanId, type PlanId } from './plans';
import type { PaymentEvent } from './provider';

const logger = createLogger('subscription');

/** After this many consecutive failed renewals, stop retrying. */
export const MAX_FAILED_ATTEMPTS = 4;

export interface SubscriptionRow {
  company_id: number;
  provider: string;
  plan: PlanId;
  status: 'active' | 'past_due' | 'canceled';
  amount: string;
  currency: string;
  provider_customer_id: string | null;
  provider_card_id: string | null;
  provider_agreement_id: string | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  next_charge_at: Date | null;
  last_charge_id: string | null;
  failed_attempts: number;
}

function addMonths(from: Date, n: number): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + n);
  return d;
}

export async function getSubscription(companyId: number): Promise<SubscriptionRow | null> {
  const r = await getPool().query<SubscriptionRow>(
    'SELECT * FROM payment_subscriptions WHERE company_id = $1 LIMIT 1',
    [companyId],
  );
  return r.rows[0] ?? null;
}

/** Start of the current billing period, for usage metering. */
export async function periodStart(companyId: number): Promise<Date> {
  const sub = await getSubscription(companyId);
  if (sub?.current_period_start) return new Date(sub.current_period_start);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Apply a successful capture: activate/renew the subscription, extend access
 * by one month, and persist any newly-vaulted card refs. No-ops if this
 * charge id was already applied.
 */
export async function applyCapturedCharge(provider: string, event: PaymentEvent): Promise<void> {
  if (event.companyId === null) {
    logger.error({ chargeId: event.chargeId }, 'captured charge without companyId metadata');
    return;
  }
  const companyId = event.companyId;
  const existing = await getSubscription(companyId);

  if (existing?.last_charge_id && existing.last_charge_id === event.chargeId) {
    logger.info({ companyId, chargeId: event.chargeId }, 'duplicate capture ignored');
    return;
  }

  const planId: PlanId = isPlanId(event.plan) ? event.plan : (existing?.plan ?? 'starter');
  const plan = getPlan(planId);
  const now = new Date();
  const periodEnd = addMonths(now, 1);

  const pool = getPool();
  await pool.query(
    `INSERT INTO payment_subscriptions
       (company_id, provider, plan, status, amount, currency,
        provider_customer_id, provider_card_id, provider_agreement_id,
        current_period_start, current_period_end, next_charge_at,
        last_charge_id, failed_attempts, updated_at)
     VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8,$9,$10,$10,$11,0,now())
     ON CONFLICT (company_id) DO UPDATE SET
       provider = EXCLUDED.provider,
       plan = EXCLUDED.plan,
       status = 'active',
       amount = EXCLUDED.amount,
       currency = EXCLUDED.currency,
       provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, payment_subscriptions.provider_customer_id),
       provider_card_id = COALESCE(EXCLUDED.provider_card_id, payment_subscriptions.provider_card_id),
       provider_agreement_id = COALESCE(EXCLUDED.provider_agreement_id, payment_subscriptions.provider_agreement_id),
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       next_charge_at = EXCLUDED.next_charge_at,
       last_charge_id = EXCLUDED.last_charge_id,
       failed_attempts = 0,
       updated_at = now()`,
    [
      companyId,
      provider,
      planId,
      plan.price.toFixed(2),
      plan.currency,
      event.providerCustomerId ?? null,
      event.providerCardId ?? null,
      event.providerAgreementId ?? null,
      now,
      periodEnd,
      event.chargeId,
    ],
  );

  // Access source of truth: extend to the new period end.
  await pool.query('UPDATE companies SET subscription_ends_at = $1 WHERE id = $2', [
    periodEnd,
    companyId,
  ]);

  logger.info({ companyId, planId, periodEnd }, 'subscription captured/renewed');
}

/** Record a failed renewal; flip to past_due / give up past the retry cap. */
export async function recordFailedCharge(companyId: number): Promise<void> {
  await getPool().query(
    `UPDATE payment_subscriptions
        SET failed_attempts = failed_attempts + 1,
            status = CASE WHEN failed_attempts + 1 >= $2 THEN 'canceled' ELSE 'past_due' END,
            next_charge_at = CASE WHEN failed_attempts + 1 >= $2 THEN NULL
                                  ELSE now() + interval '2 days' END,
            updated_at = now()
      WHERE company_id = $1`,
    [companyId, MAX_FAILED_ATTEMPTS],
  );
  logger.warn({ companyId }, 'renewal charge failed');
}

/** Subscriptions whose renewal is due and still have a vaulted card. */
export async function getDueSubscriptions(): Promise<SubscriptionRow[]> {
  const r = await getPool().query<SubscriptionRow>(
    `SELECT * FROM payment_subscriptions
      WHERE status IN ('active', 'past_due')
        AND next_charge_at IS NOT NULL
        AND next_charge_at <= now()
        AND provider_customer_id IS NOT NULL
        AND provider_card_id IS NOT NULL
        AND provider_agreement_id IS NOT NULL`,
  );
  return r.rows;
}

/**
 * Claim a due subscription so concurrent ticks don't double-charge: push
 * next_charge_at forward before charging. Returns false if another tick
 * already moved it. The window is a full day so a delayed CAPTURED webhook
 * can't trigger a same-day re-charge; the webhook resets it a month out on
 * success, and recordFailedCharge moves it on failure.
 */
export async function claimForCharge(companyId: number, was: Date | null): Promise<boolean> {
  const r = await getPool().query(
    `UPDATE payment_subscriptions
        SET next_charge_at = now() + interval '1 day', updated_at = now()
      WHERE company_id = $1 AND next_charge_at IS NOT DISTINCT FROM $2`,
    [companyId, was],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function cancelSubscription(companyId: number): Promise<void> {
  await getPool().query(
    `UPDATE payment_subscriptions
        SET status = 'canceled', next_charge_at = NULL, updated_at = now()
      WHERE company_id = $1`,
    [companyId],
  );
}
