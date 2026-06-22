/**
 * Recurring-billing cron task.
 *
 * Tap (and most gateways) won't auto-bill, so the worker drives renewals:
 * each day, find subscriptions whose next_charge_at is due, claim each one
 * (so a concurrent tick can't double-charge), and submit a merchant-initiated
 * charge against the vaulted card. Success/failure is confirmed by the
 * provider webhook — applyCapturedCharge extends access and reschedules the
 * next charge; a thrown submission is recorded as a failed attempt here.
 */

import { getPool } from '@/lib/db/client';
import { createLogger } from '@/lib/logger';
import { getActiveProvider } from '@/lib/payments/provider';
import {
  claimForCharge,
  getDueSubscriptions,
  recordFailedCharge,
} from '@/lib/payments/subscription';

const logger = createLogger('recurring-billing');

export async function recurringBillingTask(): Promise<void> {
  const due = await getDueSubscriptions();
  if (due.length === 0) return;

  const base = (process.env.DASHBOARD_URL ?? '').replace(/\/$/, '');
  if (!base) {
    logger.error('DASHBOARD_URL not set — cannot build webhook URL for renewals');
    return;
  }

  const provider = await getActiveProvider();
  const webhookUrl = `${base}/api/webhooks/${provider.id}`;
  logger.info({ count: due.length }, 'processing due renewals');

  for (const sub of due) {
    const claimed = await claimForCharge(sub.company_id, sub.next_charge_at);
    if (!claimed) continue; // another tick already took this one

    try {
      const r = await getPool().query<{
        id: number;
        name: string | null;
        email: string | null;
        phone: string | null;
      }>('SELECT id, name, email, phone FROM companies WHERE id = $1', [sub.company_id]);
      const company = r.rows[0];
      if (!company) {
        logger.warn({ companyId: sub.company_id }, 'renewal skipped — company missing');
        continue;
      }

      await provider.chargeRecurring({
        company,
        amount: Number(sub.amount),
        currency: sub.currency,
        webhookUrl,
        providerCustomerId: sub.provider_customer_id as string,
        providerCardId: sub.provider_card_id as string,
        providerAgreementId: sub.provider_agreement_id as string,
      });
      logger.info({ companyId: sub.company_id }, 'renewal charge submitted');
    } catch (err) {
      logger.error(
        { companyId: sub.company_id, err: (err as Error)?.message },
        'renewal charge failed to submit',
      );
      await recordFailedCharge(sub.company_id);
    }
  }
}
