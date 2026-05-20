"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "@/lib/router";
import {
  Search, MessageSquare, Bot, HeadphonesIcon,
  AlertTriangle, Calendar, CheckCircle2, ClipboardList,
  ClipboardCheck, Package, ChevronLeft, ChevronRight,
  Users2, BarChart3, ArrowLeft,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LabelList,
} from "recharts";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";
import { csrfFetch } from "@/lib/queryClient";

// -- Types --------------------------------------------------------------------

interface CustomerRow {
  phone: string;
  name: string | null;
  source: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  touchpoints: number;
}

interface TimelineEvent {
  type:
    | "first_contact" | "bot_message" | "agent_message"
    | "escalation" | "meeting_booked" | "meeting_completed"
    | "survey_sent" | "survey_submitted" | "order";
  timestamp: string;
  summary: string;
  meta: Record<string, any>;
}

interface JourneyData {
  customer: { phone: string; name: string | null; source: string | null; firstSeen: string | null };
  timeline: TimelineEvent[];
}

interface FunnelStage { stage: string; count: number; }

// -- Event config (icon + colours) --------------------------------------------

const EVENT_CONFIG: Record<
  TimelineEvent["type"],
  { icon: React.ReactNode; bg: string; text: string; ring: string }
> = {
  first_contact:      { icon: <MessageSquare className="w-3.5 h-3.5" />, bg: "bg-brand-blue/15",   text: "text-brand-cyan",   ring: "ring-brand-cyan/30"   },
  bot_message:        { icon: <Bot            className="w-3.5 h-3.5" />, bg: "bg-white/[0.05]",   text: "text-brand-slate",   ring: "ring-white/[0.10]"   },
  agent_message:      { icon: <HeadphonesIcon className="w-3.5 h-3.5" />, bg: "bg-brand-violet/15", text: "text-brand-violet", ring: "ring-brand-violet/30" },
  // ESCALATION — hidden for now
  // escalation:      { icon: <AlertTriangle  className="w-3.5 h-3.5" />, bg: "bg-brand-amber/15", text: "text-brand-amber", ring: "ring-brand-amber/30" },
  escalation:         { icon: <AlertTriangle  className="w-3.5 h-3.5" />, bg: "bg-white/[0.05]",   text: "text-brand-slate/70",   ring: "ring-white/[0.10]"   },
  meeting_booked:     { icon: <Calendar       className="w-3.5 h-3.5" />, bg: "bg-teal-100",   text: "text-teal-600",   ring: "ring-teal-200"   },
  meeting_completed:  { icon: <CheckCircle2   className="w-3.5 h-3.5" />, bg: "bg-brand-emerald/15",  text: "text-brand-emerald",  ring: "ring-green-200"  },
  survey_sent:        { icon: <ClipboardList  className="w-3.5 h-3.5" />, bg: "bg-brand-amber/15", text: "text-brand-amber", ring: "ring-brand-amber/30" },
  survey_submitted:   { icon: <ClipboardCheck className="w-3.5 h-3.5" />, bg: "bg-brand-emerald/15",  text: "text-brand-emerald",  ring: "ring-green-200"  },
  order:              { icon: <Package        className="w-3.5 h-3.5" />, bg: "bg-indigo-100", text: "text-indigo-600", ring: "ring-indigo-200" },
};

// Funnel bar colours
const FUNNEL_COLORS = ["#16a34a", "#65a30d", "#d97706", "#ea580c", "#dc2626"];

// -- Helpers ------------------------------------------------------------------

/** Mask a phone number: show only last 4 digits */
function maskPhone(phone: string): string {
  if (phone.length <= 4) return phone;
  return "****" + phone.slice(-4);
}

// -- Sub-components -----------------------------------------------------------

function FunnelTab() {
  const { t } = useLanguage();
  const [stages, setStages] = useState<FunnelStage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/customers/funnel", { credentials: "include" })
      .then(r => r.ok ? r.json() : { stages: [] })
      .then(d => { setStages(d.stages); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center pt-20">
        <div className="w-6 h-6 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
      </div>
    );
  }

  const annotated = stages.map((s, i) => {
    const prev = i === 0 ? null : stages[i - 1].count;
    const dropOff = prev && prev > 0 ? Math.round((1 - s.count / prev) * 100) : null;
    return { ...s, dropOff };
  });

  const max = Math.max(...stages.map(s => s.count), 1);

  return (
    <div className="space-y-6 p-6">
      <h2 className="text-base font-semibold text-white">{t("funnelTitle")}</h2>

      {/* Recharts bar chart */}
      <div className="bg-brand-navy border border-white/[0.08] rounded-xl p-4">
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={annotated}
            layout="vertical"
            margin={{ top: 0, right: 60, bottom: 0, left: 0 }}
          >
            <XAxis type="number" domain={[0, max]} hide />
            <YAxis
              type="category"
              dataKey="stage"
              width={140}
              tick={{ fontSize: 12, fill: "#6b7280" }}
            />
            <Tooltip
              formatter={(value: number) => [`${value} ${t("funnelCustomers")}`, ""]}
              cursor={{ fill: "rgba(0,0,0,0.04)" }}
            />
            <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={36}>
              {annotated.map((_, i) => (
                <Cell key={i} fill={FUNNEL_COLORS[Math.min(i, FUNNEL_COLORS.length - 1)]} />
              ))}
              <LabelList
                dataKey="count"
                position="right"
                style={{ fontSize: 12, fontWeight: 600, fill: "#374151" }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Stage table with drop-off */}
      <div className="bg-brand-navy border border-white/[0.08] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.03]/50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-brand-slate uppercase tracking-wide">Stage</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-brand-slate uppercase tracking-wide">Customers</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-brand-slate uppercase tracking-wide">{t("funnelDropOff")}</th>
              <th className="px-4 py-3 w-40"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {annotated.map((s, i) => (
              <tr key={s.stage} className="hover:bg-white/[0.03]/50">
                <td className="px-4 py-3 font-medium text-white">{s.stage}</td>
                <td className="px-4 py-3 text-right font-semibold text-white">{s.count}</td>
                <td className="px-4 py-3 text-right">
                  {s.dropOff !== null ? (
                    <span className={`text-sm font-medium ${s.dropOff >= 50 ? "text-red-400" : s.dropOff >= 25 ? "text-orange-500" : "text-brand-slate"}`}>
                      −{s.dropOff}%
                    </span>
                  ) : <span className="text-brand-slate">--</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="w-full bg-white/[0.05] rounded-full h-2">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${(s.count / max) * 100}%`,
                        backgroundColor: FUNNEL_COLORS[Math.min(i, FUNNEL_COLORS.length - 1)],
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// -- Main Page ----------------------------------------------------------------

export default function CustomersPage() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin } = useAuth();
  const { t } = useLanguage();

  const [tab, setTab] = useState<"list" | "funnel">("list");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [journeyData, setJourneyData] = useState<JourneyData | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auth guards
  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
    if (!isAuthLoading && isAuthenticated && !isAdmin) setLocation("/dashboard");
  }, [isAuthLoading, isAuthenticated, isAdmin, setLocation]);

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const res = await csrfFetch(`/api/customers?${params}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setCustomers(data.customers);
        setTotal(data.total);
      }
    } catch (_) {}
    finally { setLoading(false); }
  }, [page, debouncedSearch]);

  useEffect(() => {
    if (isAuthenticated && isAdmin) fetchCustomers();
  }, [isAuthenticated, isAdmin, fetchCustomers]);

  // Fetch journey when a customer is selected
  useEffect(() => {
    if (!selectedPhone) {
      setJourneyData(null);
      return;
    }
    setJourneyLoading(true);
    fetch(`/api/customers/${encodeURIComponent(selectedPhone)}/journey`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setJourneyData(d); setJourneyLoading(false); })
      .catch(() => { setJourneyData(null); setJourneyLoading(false); });
  }, [selectedPhone]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
      </div>
    );
  }

  const totalPages = Math.ceil(total / 20);

  // Find the selected customer object for display
  const selectedCustomer = customers.find(c => c.phone === selectedPhone) ?? null;

  return (
    <DashboardLayout noPadding>
      <div className="h-full flex flex-col">
        {/* Two-panel layout */}
        <div className="flex-1 flex min-h-0">

          {/* ── Left Panel: Customer List ── */}
          <div
            className={`
              w-full md:w-[340px] md:flex-shrink-0 border-e border-white/[0.08] bg-brand-navy flex flex-col
              ${selectedPhone ? "hidden md:flex" : "flex"}
            `}
          >
            {/* Left panel header */}
            <div className="px-5 pt-5 pb-3 flex-shrink-0">
              <h1 className="text-lg font-bold text-white">{t("customersTitle")}</h1>
              <p className="text-xs text-brand-slate/70 mt-0.5">{total} {t("customersTotal")}</p>
            </div>

            {/* Tab bar */}
            <div className="px-5 pb-3 flex-shrink-0">
              <div className="flex gap-1 bg-white/[0.05] p-1 rounded-xl">
                {(["list", "funnel"] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => { setTab(key); if (key === "funnel") setSelectedPhone(null); }}
                    className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
                      tab === key
                        ? "bg-brand-navy shadow-sm text-white"
                        : "text-brand-slate hover:text-white/90"
                    }`}
                  >
                    {key === "list" ? <Users2 className="w-3.5 h-3.5" /> : <BarChart3 className="w-3.5 h-3.5" />}
                    {key === "list" ? t("customersTabList") : t("customersTabFunnel")}
                  </button>
                ))}
              </div>
            </div>

            {tab === "list" && (
              <>
                {/* Search */}
                <div className="px-5 pb-3 flex-shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-slate/70 pointer-events-none" />
                    <input
                      type="text"
                      placeholder={t("customersSearch")}
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 text-sm border border-white/[0.08] rounded-xl bg-white/[0.03] focus:bg-brand-navy focus:outline-none focus:border-brand-blue transition-colors"
                    />
                  </div>
                </div>

                {/* Customer list (scrollable) */}
                <div className="flex-1 overflow-y-auto">
                  {loading ? (
                    <div className="flex items-center justify-center py-16">
                      <div className="w-5 h-5 border-[3px] border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
                    </div>
                  ) : customers.length === 0 ? (
                    <div className="px-5 py-12 text-center text-sm text-brand-slate">
                      {t("customersNoResults")}
                    </div>
                  ) : (
                    <div>
                      {customers.map(c => {
                        const isSelected = selectedPhone === c.phone;
                        return (
                          <button
                            key={c.phone}
                            onClick={() => setSelectedPhone(c.phone)}
                            className={`w-full text-left px-5 py-3.5 transition-colors ${
                              isSelected
                                ? "bg-brand-blue/[0.08] border-s-[3px] border-brand-blue"
                                : "hover:bg-white/[0.03] border-s-[3px] border-transparent"
                            }`}
                          >
                            <p className="text-sm font-semibold text-white truncate">
                              {c.name || <span className="text-brand-slate/70 italic font-normal">{t("customersUnknown")}</span>}
                            </p>
                            <p className="text-xs text-brand-slate/70 font-mono mt-0.5">{maskPhone(c.phone)}</p>
                            <p className="text-xs text-brand-slate/70 mt-0.5">{c.touchpoints} {t("customersTouchpoints").toLowerCase()}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.06]">
                      <p className="text-xs text-brand-slate/70">
                        {page} / {totalPages}
                      </p>
                      <div className="flex gap-1">
                        <button
                          onClick={() => setPage(p => Math.max(1, p - 1))}
                          disabled={page === 1}
                          className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.03] disabled:opacity-40 transition-colors"
                        >
                          <ChevronLeft className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                          className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.03] disabled:opacity-40 transition-colors"
                        >
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* When funnel tab is active, left panel just has the tabs -- nothing else */}
          </div>

          {/* ── Right Panel ── */}
          <div
            className={`
              flex-1 bg-white/[0.03] flex flex-col min-w-0
              ${selectedPhone ? "flex" : "hidden md:flex"}
            `}
          >
            {/* Funnel full-screen view */}
            {tab === "funnel" ? (
              <div className="flex-1 overflow-y-auto">
                <FunnelTab />
              </div>
            ) : selectedPhone ? (
              <>
                {/* Right panel header */}
                <div className="flex-shrink-0 bg-brand-navy border-b border-white/[0.08] px-5 py-4">
                  <div className="flex items-center gap-3">
                    {/* Mobile back button */}
                    <button
                      onClick={() => setSelectedPhone(null)}
                      className="md:hidden p-1.5 -ms-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4 text-brand-slate" />
                    </button>
                    <div className="min-w-0">
                      <h2 className="text-xl font-bold text-white truncate">
                        {selectedCustomer?.name || selectedPhone}
                      </h2>
                      <p className="text-sm text-brand-slate mt-0.5">
                        {t("journeyTitle")} — {journeyData?.timeline.length ?? 0} {t("customersTouchpoints").toLowerCase()}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Timeline content (scrollable) */}
                <div className="flex-1 overflow-y-auto px-5 py-6">
                  {journeyLoading ? (
                    <div className="flex justify-center pt-16">
                      <div className="w-6 h-6 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
                    </div>
                  ) : !journeyData || journeyData.timeline.length === 0 ? (
                    <p className="text-sm text-brand-slate text-center pt-16">{t("journeyNoEvents")}</p>
                  ) : (
                    <div className="relative">
                      {/* Vertical connector line */}
                      <div className="absolute top-3 bottom-3 start-[15px] w-px bg-white/[0.08]" />

                      <div className="space-y-0">
                        {journeyData.timeline.map((evt, i) => {
                          const cfg = EVENT_CONFIG[evt.type];
                          return (
                            <div key={i} className="relative flex gap-4 pb-5 last:pb-0">
                              {/* Icon circle overlapping the vertical line */}
                              <div className={`relative z-10 mt-1 w-[30px] h-[30px] rounded-full ${cfg.bg} ${cfg.text} flex items-center justify-center flex-shrink-0 ring-4 ring-gray-50`}>
                                {cfg.icon}
                              </div>
                              {/* Event card */}
                              <div className="flex-1 min-w-0 bg-brand-navy border border-white/[0.08] rounded-xl px-5 py-4 hover:shadow-md transition-shadow">
                                <p className="text-sm font-medium text-white leading-snug">{evt.summary}</p>
                                <p className="text-xs text-brand-slate mt-1">
                                  {format(new Date(evt.timestamp), "MMM d, yyyy · h:mm a")}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* Empty state -- no customer selected */
              <div className="flex-1 flex flex-col items-center justify-center text-brand-slate/70">
                <Users2 className="w-10 h-10 mb-3 text-brand-slate/50" />
                <p className="text-sm font-medium">Select a customer to view their journey</p>
              </div>
            )}
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}
