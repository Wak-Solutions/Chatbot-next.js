/**
 * Payment-provider abstraction.
 *
 * All gateway-specific logic (API calls, webhook signature verification,
 * payload parsing, the stored card/agreement tokens) lives behind this
 * interface. The rest of the billing system — plans, usage metering, the
 * access gate, the cron, the UI — depends only on these types.
 *
 * Switching providers = add one file implementing PaymentProvider and point
 * getActiveProvider() at it (via PAYMENT_PROVIDER). Nothing else changes.
 * The one thing no abstraction can move is the vaulted card itself: existing
 * subscribers must re-enter their card on the new provider.
 */

import type { Plan } from './plans';

export interface BillingCompany {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface CheckoutParams {
  company: BillingCompany;
  plan: Plan;
  /** Where the gateway returns the customer after the hosted page. */
  redirectUrl: string;
  /** Server-to-server webhook URL. */
  webhookUrl: string;
}

export interface CheckoutResult {
  /** Hosted payment-page URL to redirect the customer to. */
  url: string;
  /** Provider charge id, for our records. */
  chargeId: string;
}

export interface RecurringChargeParams {
  company: BillingCompany;
  amount: number;
  currency: string;
  webhookUrl: string;
  providerCustomerId: string;
  providerCardId: string;
  providerAgreementId: string;
}

/** Normalised webhook outcome the rest of the system understands. */
export interface PaymentEvent {
  type: 'captured' | 'declined' | 'ignored';
  chargeId: string;
  amount: number;
  currency: string;
  /** Our company id, round-tripped via gateway metadata. */
  companyId: number | null;
  /** Selected plan, round-tripped via gateway metadata. */
  plan: string | null;
  /** Card-vault identifiers, present on a save_card capture. */
  providerCustomerId?: string;
  providerCardId?: string;
  providerAgreementId?: string;
}

export interface PaymentProvider {
  readonly id: string;
  /** Create the first (card-storing) charge and return its hosted-page URL. */
  createCheckout(p: CheckoutParams): Promise<CheckoutResult>;
  /** Merchant-initiated charge against a stored card, for renewals. */
  chargeRecurring(p: RecurringChargeParams): Promise<{ chargeId: string }>;
  /** Verify the signature and normalise the payload. Null = invalid/untrusted. */
  verifyAndParseWebhook(rawBody: string, headers: Headers): PaymentEvent | null;
}

let cached: PaymentProvider | null = null;

/**
 * Resolve the active provider. Lazy + cached so importing this module never
 * eagerly reads env at build time. Defaults to Tap.
 */
export async function getActiveProvider(): Promise<PaymentProvider> {
  if (cached) return cached;
  const which = (process.env.PAYMENT_PROVIDER ?? 'tap').toLowerCase();
  switch (which) {
    case 'tap':
    default: {
      const { tapProvider } = await import('./providers/tap');
      cached = tapProvider;
      return cached;
    }
  }
}
