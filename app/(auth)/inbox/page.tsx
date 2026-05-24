"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from "react";
import { useLocation, Link } from "@/lib/router";
import { Inbox, User, Users, Clock, RefreshCw, Calendar, Video, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";
import { csrfFetch } from "@/lib/queryClient";

interface InboxItem {
  item_type: "chat" | "meeting";
  customer_phone: string;
  escalation_reason: string | null;
  chat_status: string | null;
  created_at: string;
  assigned_agent_id: number | null;
  assigned_agent_name: string | null;
  meeting_id: number | null;
  meeting_scheduled_at: string | null;
  meeting_status: string | null;
  meeting_link: string | null;
  meeting_agent_id: number | null;
  meeting_agent_name: string | null;
}

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function formatKsa(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const colors: Record<string, string> = {
    in_progress: "bg-brand-amber/15 text-brand-amber border border-brand-amber/30",
    closed: "bg-brand-emerald/15 text-brand-emerald border border-brand-emerald/30",
    resolved: "bg-brand-emerald/15 text-brand-emerald border border-brand-emerald/30",
    completed: "bg-brand-emerald/15 text-brand-emerald border border-brand-emerald/30",
    open: "bg-white/[0.05] text-brand-slate border border-white/[0.08]",
    pending: "bg-brand-blue/15 text-brand-cyan border border-brand-cyan/30",
  };
  return (
    <span className={`text-[11px] font-medium px-2.5 py-1 rounded-full ${colors[status] ?? colors.open}`}>
      {label}
    </span>
  );
}

function MeetingModal({ item, onClose }: { item: InboxItem; onClose: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="bg-brand-navy rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-brand-cyan" />
            <h3 className="text-base font-semibold text-white">{t("inboxMeetingDetails")}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-brand-slate/70 hover:text-brand-slate hover:bg-white/[0.05] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-4">
          <div className="bg-white/[0.03] rounded-xl p-4 space-y-3">
            <div>
              <p className="text-xs text-brand-slate uppercase tracking-wider font-medium mb-0.5">{t("inboxCustomer")}</p>
              <p className="text-sm font-semibold font-mono text-white">{item.customer_phone}</p>
            </div>
            {item.meeting_scheduled_at && (
              <div>
                <p className="text-xs text-brand-slate uppercase tracking-wider font-medium mb-0.5">{t("inboxDateTime")}</p>
                <p className="text-sm font-semibold text-white">{formatKsa(item.meeting_scheduled_at)}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-brand-slate uppercase tracking-wider font-medium mb-0.5">{t("inboxStatus")}</p>
              <StatusBadge status={item.meeting_status ?? "pending"} label={item.meeting_status ?? "pending"} />
            </div>
            <div>
              <p className="text-xs text-brand-slate uppercase tracking-wider font-medium mb-0.5">{t("inboxAssignedAgent")}</p>
              {item.meeting_agent_name
                ? <p className="text-sm text-white">{item.meeting_agent_name}</p>
                : <p className="text-sm text-brand-slate/70 italic">{t("inboxUnassigned")}</p>}
            </div>
          </div>
          {item.meeting_link && (
            <a
              href={item.meeting_link}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-blue hover:bg-brand-cyan text-white text-sm font-semibold rounded-xl transition-colors"
            >
              <Video className="w-4 h-4" /> {t("inboxJoinMeeting")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

type Tab = "shared" | "mine" | "all";

export default function InboxPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin, agentId } = useAuth();
  const [tab, setTab] = useState<Tab>("shared");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [meetingModal, setMeetingModal] = useState<InboxItem | null>(null);
  const { t } = useLanguage();

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

  const fetchData = useCallback(async () => {
    try {
      const res = await csrfFetch("/api/inbox", { credentials: "include" });
      if (res.ok) setItems(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchData();
      const interval = setInterval(fetchData, 15000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, fetchData]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && isAuthenticated) fetchData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchData, isAuthenticated]);

  // ESCALATION — hidden for now
  // const claim = async (phone: string) => {
  //   setClaiming(phone);
  //   setError("");
  //   try {
  //     const res = await fetch(`/api/escalations/${encodeURIComponent(phone)}/claim`, {
  //       method: "PATCH",
  //       credentials: "include",
  //     });
  //     if (!res.ok) {
  //       const body = await res.json().catch(() => ({}));
  //       setError(body.message || t("inboxClaimError"));
  //     } else {
  //       await fetchData();
  //     }
  //   } catch {
  //     setError(t("inboxNetworkError"));
  //   } finally {
  //     setClaiming(null);
  //   }
  // };

  const sharedItems = items.filter(item =>
    item.item_type === "chat" ? item.assigned_agent_id === null : item.meeting_agent_id === null,
  );
  const myItems = items.filter(item =>
    item.item_type === "chat" ? item.assigned_agent_id === agentId : item.meeting_agent_id === agentId,
  );

  const tabs: { key: Tab; label: string; count: number; show: boolean }[] = [
    { key: "shared", label: t("inboxTabShared"), count: sharedItems.length, show: true },
    { key: "mine", label: t("inboxTabMy"), count: myItems.length, show: true },
    { key: "all", label: t("inboxTabAll"), count: items.length, show: isAdmin },
  ];

  const activeItems = tab === "shared" ? sharedItems : tab === "mine" ? myItems : items;

  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          {/* Page header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white">{t("inboxTitle")}</h1>
              <p className="text-sm text-brand-slate mt-1">{items.length} items</p>
            </div>
            <button
              onClick={fetchData}
              className="flex items-center gap-1.5 text-xs font-medium text-brand-slate border border-white/[0.08] px-3 py-2 rounded-lg hover:bg-white/[0.03] transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-white/[0.05] p-1 rounded-xl w-fit mb-5">
            {tabs.filter(tb => tb.show).map(tb => (
              <button
                key={tb.key}
                onClick={() => setTab(tb.key)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  tab === tb.key ? "bg-brand-navy shadow-sm text-white" : "text-brand-slate hover:text-white/90"
                }`}
              >
                {tb.key === "all" ? <Users className="w-3.5 h-3.5" /> : <Inbox className="w-3.5 h-3.5" />}
                {tb.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                  tab === tb.key ? "bg-brand-blue text-white" : "bg-white/[0.10]/50 text-brand-slate"
                }`}>
                  {tb.count}
                </span>
              </button>
            ))}
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 mb-4">{error}</p>
          )}

          {/* Items */}
          <div className="space-y-2">
            {activeItems.length === 0 ? (
              <div className="bg-brand-navy border border-white/[0.08] rounded-xl flex flex-col items-center justify-center py-16 text-brand-slate/70 gap-2">
                <Inbox className="w-10 h-10 opacity-30" />
                <p className="text-sm">
                  {tab === "shared" ? t("inboxEmptyShared") : tab === "mine" ? t("inboxEmptyMy") : t("inboxEmptyAll")}
                </p>
              </div>
            ) : (
              activeItems.map(item =>
                item.item_type === "meeting" ? (
                  <div key={`meeting-${item.meeting_id}`} className="bg-brand-navy border border-white/[0.08] rounded-xl px-4 py-3 flex items-center gap-3 hover:bg-white/[0.03]/50 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-brand-blue/15 flex items-center justify-center shrink-0">
                      <Calendar className="w-4 h-4 text-brand-cyan" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium text-white font-mono">{item.customer_phone}</p>
                        <StatusBadge status={item.meeting_status ?? "pending"} label={item.meeting_status ?? "pending"} />
                      </div>
                      {item.meeting_scheduled_at && (
                        <p className="text-xs text-brand-slate mt-0.5">{formatKsa(item.meeting_scheduled_at)}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setMeetingModal(item)}
                      className="px-3 py-1.5 text-xs font-medium border border-white/[0.08] text-white/90 rounded-lg hover:bg-white/[0.03] transition-colors"
                    >
                      {t("inboxView")}
                    </button>
                  </div>
                ) : (
                  <div key={item.customer_phone} className="bg-brand-navy border border-white/[0.08] rounded-xl px-4 py-3 hover:bg-white/[0.03]/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-brand-blue/10 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-brand-blue" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-white font-mono">{item.customer_phone}</p>
                          <StatusBadge
                            status={item.chat_status ?? "open"}
                            label={item.chat_status === "in_progress" ? `${t("statusInProgress")}${item.assigned_agent_name ? ` · ${item.assigned_agent_name}` : ""}` : item.chat_status === "closed" || item.chat_status === "resolved" ? t("statusResolved") : t("statusOpen")}
                          />
                        </div>
                        {/* ESCALATION — hidden for now */}
                        {/* {item.escalation_reason && (
                          <p className="text-xs text-brand-slate truncate">{item.escalation_reason}</p>
                        )} */}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Clock className="w-3 h-3 text-brand-slate/70" />
                          <span className="text-xs text-brand-slate/70">{timeAgo(item.created_at)}</span>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {/* ESCALATION — hidden for now */}
                        {/* {tab === "shared" ? (
                          <button
                            onClick={() => claim(item.customer_phone)}
                            disabled={claiming === item.customer_phone}
                            className="px-3 py-1.5 text-xs font-medium bg-brand-blue text-white rounded-lg hover:bg-brand-cyan disabled:opacity-50 transition-colors"
                          >
                            {claiming === item.customer_phone ? t("inboxClaiming") : t("inboxClaim")}
                          </button>
                        ) : ( */}
                          <Link href={`/dashboard?phone=${encodeURIComponent(item.customer_phone)}`} className="px-3 py-1.5 text-xs font-medium border border-brand-blue/30 text-brand-blue rounded-lg hover:bg-brand-blue/5 transition-colors">
                            {t("inboxOpen")}
                          </Link>
                        {/* )} */}
                      </div>
                    </div>
                    {item.meeting_id && item.meeting_scheduled_at && (
                      <button
                        onClick={() => setMeetingModal(item)}
                        className="mt-2 ms-12 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-blue/10 border border-brand-cyan/30 text-xs text-brand-cyan font-medium hover:bg-brand-blue/15 transition-colors"
                      >
                        <Calendar className="w-3 h-3" />
                        {t("inboxMeeting")} · {formatKsa(item.meeting_scheduled_at)}
                      </button>
                    )}
                  </div>
                ),
              )
            )}
          </div>
        </div>
      </div>

      {meetingModal && <MeetingModal item={meetingModal} onClose={() => setMeetingModal(null)} />}
    </DashboardLayout>
  );
}
