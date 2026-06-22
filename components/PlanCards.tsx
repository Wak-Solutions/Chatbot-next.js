"use client";

/**
 * Reusable pricing grid. Renders the three plan tiers with a Subscribe /
 * Upgrade button that kicks off hosted checkout. Used by the billing settings
 * panel and the trial-ended renew prompt.
 */

import { useState } from "react";
import { Check } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { startCheckout, type BillingPlan } from "@/lib/payments/client";

export default function PlanCards({
  plans,
  currentPlan,
}: {
  plans: BillingPlan[];
  currentPlan?: string | null;
}) {
  const { t: rawT } = useLanguage();
  const t = rawT as unknown as (key: string) => string;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const subscribe = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await startCheckout(id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="grid sm:grid-cols-3 gap-4">
        {plans.map((p) => {
          const isCurrent = currentPlan === p.id;
          return (
            <div
              key={p.id}
              className={`rounded-2xl border p-5 flex flex-col ${
                isCurrent
                  ? "border-brand-blue bg-brand-blue/[0.07]"
                  : "border-white/[0.08] bg-brand-navy"
              }`}
            >
              <div className="text-white font-semibold">{p.name}</div>
              <div className="mt-2 text-2xl font-bold text-white">
                {p.price}
                <span className="text-sm font-normal text-brand-slate"> {p.currency}/{t("billingPerMonth")}</span>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm text-brand-slate flex-1">
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-brand-emerald shrink-0" />
                  {p.chats.toLocaleString()} {t("billingChats")}
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-brand-emerald shrink-0" />
                  {p.messages.toLocaleString()} {t("billingMessages")}
                </li>
              </ul>
              <button
                type="button"
                disabled={isCurrent || busy !== null}
                onClick={() => subscribe(p.id)}
                className="mt-4 rounded-xl px-4 py-2 text-sm font-semibold bg-brand-blue text-white hover:bg-brand-cyan disabled:opacity-50 transition-colors"
              >
                {isCurrent
                  ? t("billingCurrentPlan")
                  : busy === p.id
                    ? t("billingRedirecting")
                    : t("billingChoose")}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}
