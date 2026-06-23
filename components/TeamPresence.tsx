"use client";

/**
 * Compact "who's online" strip for the sidebar — visible to every agent.
 * Polls /api/agents/presence every 30s and shows the available teammates as
 * initial chips (hover for the name).
 */

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/language-context";

interface Member {
  id: number;
  name: string;
  available: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export default function TeamPresence() {
  const { t: rawT } = useLanguage();
  const t = rawT as unknown as (k: string) => string;
  const [members, setMembers] = useState<Member[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/agents/presence", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((d) => {
          if (alive) setMembers(Array.isArray(d) ? d : []);
        })
        .catch(() => {});
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (members.length === 0) return null;
  const online = members.filter((m) => m.available);

  return (
    <div className="px-5 py-3 border-t border-white/10">
      <div className="flex items-center gap-2 mb-2">
        <span className="w-2 h-2 rounded-full bg-brand-emerald shrink-0" />
        <span className="text-[12px] font-medium text-white/70">
          {online.length} {t("presenceOnline")}
        </span>
      </div>
      {online.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {online.map((m) => (
            <span
              key={m.id}
              title={m.name}
              className="w-7 h-7 rounded-full bg-brand-emerald/15 flex items-center justify-center text-[10px] font-bold text-brand-emerald"
            >
              {initials(m.name)}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-brand-slate">{t("presenceNobody")}</p>
      )}
    </div>
  );
}
