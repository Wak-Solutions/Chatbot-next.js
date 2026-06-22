"use client";

/**
 * Public trial-ended renew page. A user whose trial expired can't log in, so
 * this page collects their credentials + a plan and starts hosted checkout via
 * /api/billing/renew-checkout (which verifies the credentials server-side).
 */

import { useState } from "react";
import { Check } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { PLANS, PLAN_ORDER, type PlanId } from "@/lib/payments/plans";

export default function RenewPage() {
  const { t: rawT, lang } = useLanguage();
  const t = rawT as unknown as (key: string) => string;
  const isRtl = lang === "ar";

  const [plan, setPlan] = useState<PlanId>("starter");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/billing/renew-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, plan }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.url) {
        setError(data.message || t("loginErrorCredentials"));
        setBusy(false);
        return;
      }
      window.location.href = data.url as string;
    } catch {
      setError(t("loginErrorCredentials"));
      setBusy(false);
    }
  };

  const inputClass =
    "w-full rounded-xl bg-white/[0.04] border border-white/[0.08] px-4 py-2.5 text-white placeholder:text-brand-slate/50 focus:outline-none focus:border-brand-blue";

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen bg-brand-ink flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white">{t("trialEndedTitle")}</h1>
          <p className="text-brand-slate mt-2">{t("trialEndedBody")}</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-3 mb-6">
          {PLAN_ORDER.map((id) => {
            const p = PLANS[id];
            const selected = plan === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setPlan(id)}
                className={`text-start rounded-2xl border p-4 transition-colors ${
                  selected
                    ? "border-brand-blue bg-brand-blue/[0.08]"
                    : "border-white/[0.08] bg-brand-navy hover:border-white/20"
                }`}
              >
                <div className="text-white font-semibold">{p.name}</div>
                <div className="mt-1 text-xl font-bold text-white">
                  {p.price}
                  <span className="text-xs font-normal text-brand-slate"> {p.currency}/{t("billingPerMonth")}</span>
                </div>
                <ul className="mt-2 space-y-1 text-xs text-brand-slate">
                  <li className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-brand-emerald shrink-0" />
                    {p.chats.toLocaleString()} {t("billingChats")}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <Check className="w-3 h-3 text-brand-emerald shrink-0" />
                    {p.messages.toLocaleString()} {t("billingMessages")}
                  </li>
                </ul>
              </button>
            );
          })}
        </div>

        <form onSubmit={submit} className="max-w-md mx-auto space-y-4 bg-brand-navy border border-white/[0.08] rounded-2xl p-6">
          <div>
            <label className="block text-sm font-medium text-white/90 mb-1.5">Email or Mobile Number</label>
            <input
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com or +966501234567"
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-white/90 mb-1.5">{t("loginPassword")}</label>
            <input
              type="password"
              className={inputClass}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("loginPasswordPlaceholder")}
              autoComplete="current-password"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full bg-brand-blue text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-cyan disabled:opacity-50 transition-colors"
          >
            {busy ? t("billingRedirecting") : t("renew")}
          </button>
        </form>
      </div>
    </div>
  );
}
