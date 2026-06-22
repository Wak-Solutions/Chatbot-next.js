"use client";

/**
 * Client-side billing helpers shared by the settings panel and the
 * trial-ended renew prompt. Thin wrappers over the billing API.
 */

import { csrfFetch } from "@/lib/queryClient";

export interface BillingPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  chats: number;
  messages: number;
}

export interface BillingData {
  plans: BillingPlan[];
  subscription: {
    plan: string;
    status: string;
    currentPeriodEnd: string | null;
    nextChargeAt: string | null;
  } | null;
  usage: { chats: number; messages: number };
  limits: { chats: number; messages: number } | null;
}

export async function fetchBilling(): Promise<BillingData> {
  const r = await fetch("/api/billing", { credentials: "include" });
  if (!r.ok) throw new Error("Failed to load billing");
  return r.json();
}

/** Starts checkout and redirects the browser to the hosted payment page. */
export async function startCheckout(plan: string): Promise<void> {
  const r = await csrfFetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ plan }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.url) throw new Error(data.message || "Could not start checkout");
  window.location.href = data.url as string;
}

export async function cancelBilling(): Promise<void> {
  const r = await csrfFetch("/api/billing/cancel", {
    method: "POST",
    credentials: "include",
  });
  if (!r.ok) throw new Error("Could not cancel");
}
