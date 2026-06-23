"use client";

export const dynamic = 'force-dynamic';

import { useState, useMemo } from "react";
import { useLocation } from "@/lib/router";
import { useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon, RefreshCw, Check, Hand } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useConversations } from "@/hooks/use-conversations";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";
import { csrfFetch } from "@/lib/queryClient";
import { api } from "@/lib/contracts/routes";
import type { Conversation } from "@/lib/contracts/schema-types";

type Tab = "shared" | "unclaimed" | "mine" | "resolved";

function initials(name: string | null, phone: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  return phone.replace(/\D/g, "").slice(-2);
}

function statusLabel(c: Conversation, t: (k: string) => string): string | null {
  if (c.escalation_status === "closed") return t("statusResolved");
  if (c.escalation_status === "in_progress")
    return c.assigned_agent_name ? `${t("statusInProgress")} · ${c.assigned_agent_name}` : t("statusInProgress");
  if (c.escalation_status === "open") return t("inboxTabUnclaimed");
  return null;
}

export default function InboxPage() {
  const { t: rawT } = useLanguage();
  const t = rawT as unknown as (k: string) => string;
  const { agentId } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: conversations = [], isLoading, refetch } = useConversations();
  const [tab, setTab] = useState<Tab>("shared");
  const [busy, setBusy] = useState<string | null>(null);

  const buckets = useMemo(() => {
    const active = (c: Conversation) =>
      c.escalation_status === "open" || c.escalation_status === "in_progress";
    return {
      shared: conversations,
      unclaimed: conversations.filter((c) => c.escalation_status === "open" && c.assigned_agent_id == null),
      mine: conversations.filter((c) => c.assigned_agent_id === agentId && active(c)),
      resolved: conversations.filter((c) => c.escalation_status === "closed"),
    } as Record<Tab, Conversation[]>;
  }, [conversations, agentId]);

  const act = async (phone: string, action: "claim" | "resolve") => {
    setBusy(phone);
    try {
      await csrfFetch(`/api/conversations/${encodeURIComponent(phone)}/${action}`, {
        method: "POST",
        credentials: "include",
      });
      await qc.invalidateQueries({ queryKey: [api.conversations.list.path] });
    } finally {
      setBusy(null);
    }
  };

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "shared", label: t("inboxTabShared"), count: buckets.shared.length },
    { key: "unclaimed", label: t("inboxTabUnclaimed"), count: buckets.unclaimed.length },
    { key: "mine", label: t("inboxTabMy"), count: buckets.mine.length },
    { key: "resolved", label: t("inboxTabResolved"), count: buckets.resolved.length },
  ];
  const items = buckets[tab];

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <InboxIcon className="w-5 h-5 text-brand-cyan" />
            <h1 className="text-2xl font-bold text-white">{t("inbox")}</h1>
          </div>
          <button
            onClick={() => refetch()}
            className="p-2 rounded-lg text-brand-slate hover:text-white hover:bg-white/[0.05] transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 mb-5 border-b border-white/[0.06]">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`px-3.5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === tb.key
                  ? "border-brand-cyan text-white"
                  : "border-transparent text-brand-slate hover:text-white"
              }`}
            >
              {tb.label}
              <span className="ms-1.5 text-xs text-brand-slate">{tb.count}</span>
            </button>
          ))}
        </div>

        {/* List */}
        {isLoading ? (
          <p className="text-sm text-brand-slate py-12 text-center">…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-brand-slate py-12 text-center">{t("inboxEmpty")}</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((c) => {
              const canClaim = c.assigned_agent_id !== agentId && c.escalation_status !== "closed";
              const canResolve = c.escalation_status === "open" || c.escalation_status === "in_progress";
              const label = statusLabel(c, t);
              return (
                <li key={c.customer_phone}>
                  <div
                    onClick={() => navigate(`/dashboard?phone=${encodeURIComponent(c.customer_phone)}`)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-brand-navy border border-white/[0.06] hover:border-white/15 cursor-pointer transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-brand-blue/15 flex items-center justify-center shrink-0">
                      <span className="text-[13px] font-semibold text-brand-cyan">
                        {initials(c.customer_name, c.customer_phone)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-semibold text-white truncate">
                          {c.customer_name || c.customer_phone}
                        </span>
                        {label && (
                          <span className="text-[11px] text-brand-slate shrink-0">· {label}</span>
                        )}
                      </div>
                      <p className="text-[13px] text-brand-slate truncate">{c.last_message || ""}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {canClaim && (
                        <button
                          onClick={() => act(c.customer_phone, "claim")}
                          disabled={busy === c.customer_phone}
                          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-brand-blue/15 text-brand-cyan hover:bg-brand-blue/25 disabled:opacity-50 transition-colors"
                        >
                          <Hand className="w-3.5 h-3.5" />
                          {t("inboxClaim")}
                        </button>
                      )}
                      {canResolve && (
                        <button
                          onClick={() => act(c.customer_phone, "resolve")}
                          disabled={busy === c.customer_phone}
                          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-brand-emerald/15 text-brand-emerald hover:bg-brand-emerald/25 disabled:opacity-50 transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {t("inboxResolve")}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </DashboardLayout>
  );
}
