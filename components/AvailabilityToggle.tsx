"use client";

/**
 * The logged-in agent's manual Available/Away switch (presence model B).
 * Reads/writes /api/me/availability. Used to show who's present and to scope
 * auto-assignment to available agents.
 */

import { useEffect, useState } from "react";
import { csrfFetch } from "@/lib/queryClient";
import { useLanguage } from "@/lib/language-context";

export default function AvailabilityToggle() {
  const { t: rawT } = useLanguage();
  const t = rawT as unknown as (k: string) => string;
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/me/availability", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => setAvailable(Boolean(d.available)))
      .catch(() => {});
  }, []);

  const toggle = async () => {
    const next = !available;
    setBusy(true);
    setAvailable(next); // optimistic
    try {
      const r = await csrfFetch("/api/me/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ available: next }),
      });
      if (!r.ok) setAvailable(!next); // revert on failure
    } catch {
      setAvailable(!next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="flex items-center gap-1.5 text-[12px] font-medium px-2 py-1 rounded-lg text-white/70 hover:bg-white/[0.06] disabled:opacity-50 transition-colors"
      title={available ? t("presenceAvailable") : t("presenceAway")}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${available ? "bg-brand-emerald" : "bg-brand-slate/50"}`}
      />
      {available ? t("presenceAvailable") : t("presenceAway")}
    </button>
  );
}
