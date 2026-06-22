/**
 * Tap Payments adapter — implements PaymentProvider.
 *
 * Docs: https://developers.tap.company
 *  - Charges:   POST https://api.tap.company/v2/charges
 *  - Tokens:    POST https://api.tap.company/v2/tokens  (from saved card)
 *  - Webhooks:  HMAC-SHA256 `hashstring` header over a fixed field order.
 *
 * Tap has no auto-biller: the first charge stores the card (save_card),
 * returning customer/card/payment-agreement ids; renewals are merchant-
 * initiated charges we trigger from the worker cron.
 *
 * Secret key is read from env at call time and never leaves the backend.
 */

import { createHmac } from 'node:crypto';
import { createLogger } from '@/lib/logger';
import type {
  CheckoutParams,
  CheckoutResult,
  PaymentEvent,
  PaymentProvider,
  RecurringChargeParams,
} from '../provider';

const logger = createLogger('tap');
const API_BASE = 'https://api.tap.company/v2';

/** Decimal precision Tap expects per currency for amounts and the hashstring. */
const CURRENCY_DECIMALS: Record<string, number> = { KWD: 3, BHD: 3, SAR: 2, AED: 2, USD: 2 };

function formatAmount(amount: number, currency: string): string {
  return amount.toFixed(CURRENCY_DECIMALS[currency] ?? 2);
}

function secretKey(): string {
  const key = process.env.TAP_SECRET_KEY;
  if (!key) throw new Error('TAP_SECRET_KEY is not set');
  return key;
}

/** Best-effort split of a stored phone string into Tap's {country_code, number}. */
function splitPhone(phone: string | null): { country_code: string; number: string } {
  const digits = (phone ?? '').replace(/[^\d]/g, '');
  // Default to Saudi Arabia (966) when no country code is discernible.
  if (digits.startsWith('966')) return { country_code: '966', number: digits.slice(3) };
  if (digits.startsWith('0')) return { country_code: '966', number: digits.slice(1) };
  return { country_code: '966', number: digits };
}

async function tapFetch(path: string, body: unknown): Promise<Record<string, unknown>> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok) {
    logger.error({ path, status: resp.status, json }, 'Tap API error');
    throw new Error(`Tap ${path} failed: ${resp.status}`);
  }
  return json;
}

async function createCheckout(p: CheckoutParams): Promise<CheckoutResult> {
  const { company, plan, redirectUrl, webhookUrl } = p;
  const phone = splitPhone(company.phone);
  const charge = await tapFetch('/charges', {
    amount: formatAmount(plan.price, plan.currency),
    currency: plan.currency,
    threeDSecure: true,
    save_card: true,
    description: `${plan.name} plan subscription`,
    customer: {
      first_name: company.name || `Company ${company.id}`,
      email: company.email || undefined,
      phone: { country_code: phone.country_code, number: phone.number },
    },
    source: { id: 'src_all' },
    redirect: { url: redirectUrl },
    post: { url: webhookUrl },
    metadata: { companyId: String(company.id), plan: plan.id },
  });

  const transaction = charge.transaction as { url?: string } | undefined;
  const url = transaction?.url;
  const chargeId = charge.id as string | undefined;
  if (!url || !chargeId) throw new Error('Tap checkout: missing transaction.url / id');
  return { url, chargeId };
}

async function chargeRecurring(p: RecurringChargeParams): Promise<{ chargeId: string }> {
  // 1. One-time token from the vaulted card (expires in 5 min).
  const token = await tapFetch('/tokens', {
    saved_card: { card_id: p.providerCardId, customer_id: p.providerCustomerId },
  });
  const tokenId = token.id as string | undefined;
  if (!tokenId) throw new Error('Tap recurring: token creation returned no id');

  // 2. Merchant-initiated charge against the payment agreement.
  const charge = await tapFetch('/charges', {
    amount: formatAmount(p.amount, p.currency),
    currency: p.currency,
    threeDSecure: false,
    customer_initiated: false,
    customer: { id: p.providerCustomerId },
    source: { id: tokenId },
    payment_agreement: { id: p.providerAgreementId },
    post: { url: p.webhookUrl },
    metadata: { companyId: String(p.company.id) },
  });
  const chargeId = charge.id as string | undefined;
  if (!chargeId) throw new Error('Tap recurring: charge returned no id');
  return { chargeId };
}

/**
 * Verify the `hashstring` header (HMAC-SHA256, secret key) over Tap's fixed
 * field order, then normalise the payload. Returns null on any mismatch so
 * the route can 401 without trusting the body.
 */
function verifyAndParseWebhook(rawBody: string, headers: Headers): PaymentEvent | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return null;
  }

  const id = String(body.id ?? '');
  const currency = String(body.currency ?? '');
  const amountNum = Number(body.amount ?? 0);
  const status = String(body.status ?? '');
  const reference = (body.reference ?? {}) as { gateway?: string; payment?: string };
  const transaction = (body.transaction ?? {}) as { created?: string | number };

  const toHash =
    `x_id${id}` +
    `x_amount${formatAmount(amountNum, currency)}` +
    `x_currency${currency}` +
    `x_gateway_reference${reference.gateway ?? ''}` +
    `x_payment_reference${reference.payment ?? ''}` +
    `x_status${status}` +
    `x_created${transaction.created ?? ''}`;

  const expected = createHmac('sha256', secretKey()).update(toHash).digest('hex');
  const presented = headers.get('hashstring') ?? '';
  if (!presented || presented !== expected) {
    logger.warn({ id, status }, 'Tap webhook hashstring mismatch');
    return null;
  }

  const metadata = (body.metadata ?? {}) as { companyId?: string; plan?: string };
  const card = (body.card ?? {}) as { id?: string };
  const customer = (body.customer ?? {}) as { id?: string };
  const agreement = (body.payment_agreement ?? {}) as { id?: string };

  const type: PaymentEvent['type'] =
    status === 'CAPTURED' ? 'captured' : status === 'DECLINED' ? 'declined' : 'ignored';

  return {
    type,
    chargeId: id,
    amount: amountNum,
    currency,
    companyId: metadata.companyId ? Number(metadata.companyId) : null,
    plan: metadata.plan ?? null,
    providerCustomerId: customer.id,
    providerCardId: card.id,
    providerAgreementId: agreement.id,
  };
}

export const tapProvider: PaymentProvider = {
  id: 'tap',
  createCheckout,
  chargeRecurring,
  verifyAndParseWebhook,
};
