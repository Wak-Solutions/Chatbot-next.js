"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "@/lib/router";
import { Video, ChevronLeft, ChevronRight, Ban, Clock } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";
import { csrfFetch } from "@/lib/queryClient";
import { isWithinWorkHours } from "@/lib/meetings/slots";

type MeetingStatus = "pending" | "in_progress" | "completed";
type FilterType = "all" | "upcoming" | "completed";

interface Meeting {
  id: number;
  customer_phone: string | null;
  customer_name: string | null;
  agent_id: number | null;
  agent_name: string | null;
  meeting_link: string;
  meeting_token: string | null;
  agreed_time: string | null;
  scheduled_at: string | null;
  status: MeetingStatus;
  created_at: string;
  source?: 'meeting' | 'demo';
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const ksa = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[ksa.getUTCDay()]} ${ksa.getUTCDate()} ${months[ksa.getUTCMonth()]} ${ksa.getUTCFullYear()}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const ksa = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const hh = String(ksa.getUTCHours()).padStart(2, "0");
  const mm = String(ksa.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} AST`;
}

const SLOT_HOURS = ["07:00","08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00","22:00","23:00","00:00"];
const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

// ── Work hours types + constants ──────────────────────────────────────────────

interface WorkHours {
  days: string[];
  start: string;
  end: string;
  timezone: string;
}

const ALL_WEEK_DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const DEFAULT_WORK_HOURS: WorkHours = {
  days: ["Sun","Mon","Tue","Wed","Thu"],
  start: "09:00",
  end: "18:00",
  timezone: "Asia/Riyadh",
};

// Generate time options in 30-minute increments from 00:00 to 23:30
const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  TIME_OPTIONS.push(`${String(h).padStart(2,"0")}:00`);
  TIME_OPTIONS.push(`${String(h).padStart(2,"0")}:30`);
}

const COMMON_TIMEZONES = [
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Kuwait",
  "Asia/Bahrain",
  "Asia/Qatar",
  "Africa/Cairo",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "UTC",
];

// ── WorkHoursPanel component ──────────────────────────────────────────────────

function WorkHoursPanel() {
  const { t } = useLanguage();
  const [wh, setWh] = useState<WorkHours>(DEFAULT_WORK_HOURS);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle"|"saving"|"saved"|"error">("idle");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userEditedRef = useRef(false);
  const whRef = useRef(wh);
  whRef.current = wh;

  // Load on mount
  useEffect(() => {
    fetch("/api/settings/work-hours", { credentials: "include" })
      .then(r => r.json())
      .then(data => {
        if (data.days && data.start && data.end && data.timezone) setWh(data as WorkHours);
      })
      .catch(() => setLoadError(t("workHoursErrorLoad")));
  }, []);

  // Autosave 800ms after change
  const doSave = useCallback(async () => {
    setSaveStatus("saving");
    try {
      const res = await csrfFetch("/api/settings/work-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(whRef.current),
      });
      if (!res.ok) throw new Error();
      setSaveStatus("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveStatus("idle"), 2500);
    } catch {
      setSaveStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!userEditedRef.current) return;
    const t = setTimeout(doSave, 800);
    return () => clearTimeout(t);
  }, [wh, doSave]);

  const update = (patch: Partial<WorkHours>) => {
    userEditedRef.current = true;
    setWh(prev => ({ ...prev, ...patch }));
  };

  const toggleDay = (day: string) => {
    const next = wh.days.includes(day)
      ? wh.days.filter(d => d !== day)
      : [...wh.days, day];
    update({ days: next });
  };

  const inputCls = "border border-white/[0.08] rounded-lg px-3 py-2 text-sm bg-brand-navy text-white focus:outline-none focus:ring-2 focus:ring-brand-blue/40 transition-shadow";

  return (
    <div className="bg-brand-navy border border-white/[0.08] rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 pt-5 pb-4 border-b border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-brand-blue" />
          <div>
            <h2 className="text-sm font-semibold text-white">{t("workHoursTitle")}</h2>
            <p className="text-xs text-brand-slate/70 mt-0.5">{t("workHoursDesc")}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs min-w-[80px] justify-end">
          {saveStatus === "saving" && <><span className="w-1.5 h-1.5 rounded-full bg-brand-slate flex-shrink-0" /><span className="text-brand-slate/70">{t("workHoursSaving")}</span></>}
          {saveStatus === "saved"  && <><span className="w-1.5 h-1.5 rounded-full bg-brand-blue flex-shrink-0" /><span className="text-brand-blue">{t("workHoursSaved")}</span></>}
          {saveStatus === "error"  && <><span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" /><span className="text-red-400">{t("workHoursErrorSave")}</span></>}
        </div>
      </div>

      {loadError && (
        <p className="mx-5 mt-3 text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{loadError}</p>
      )}

      <div className="px-5 py-4 space-y-5">
        {/* Day pills */}
        <div>
          <p className="text-xs font-medium text-brand-slate mb-2">{t("workHoursDays")}</p>
          <div className="flex flex-wrap gap-2">
            {ALL_WEEK_DAYS.map(day => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  wh.days.includes(day)
                    ? "bg-brand-blue text-white border-brand-blue"
                    : "bg-brand-navy text-brand-slate border-white/[0.08] hover:border-brand-blue/40"
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        {/* Time range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-brand-slate mb-1.5">{t("workHoursStartTime")}</label>
            <select
              className={inputCls + " w-full"}
              value={wh.start}
              onChange={e => update({ start: e.target.value })}
            >
              {TIME_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-brand-slate mb-1.5">{t("workHoursEndTime")}</label>
            <select
              className={inputCls + " w-full"}
              value={wh.end}
              onChange={e => update({ end: e.target.value })}
            >
              {TIME_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Timezone */}
        <div>
          <label className="block text-xs font-medium text-brand-slate mb-1.5">{t("workHoursTimezone")}</label>
          <select
            className={inputCls + " w-full"}
            value={wh.timezone}
            onChange={e => update({ timezone: e.target.value })}
          >
            {COMMON_TIMEZONES.map(tz => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function getMondayOf(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  x.setDate(x.getDate() - ((day + 6) % 7));
  x.setHours(0, 0, 0, 0);
  return x;
}

function toDateStr(d: Date): string { return d.toISOString().slice(0, 10); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

const statusBadge: Record<string, string> = {
  // pending: brand-cyan accent on blue tint (informational, not "success" yet)
  pending: "border border-brand-cyan/30 bg-brand-blue/15 text-brand-cyan",
  // in_progress: amber (warning/active)
  in_progress: "border border-brand-amber/30 bg-brand-amber/15 text-brand-amber",
  // completed: emerald (semantic success)
  completed: "border border-brand-emerald/30 bg-brand-emerald/15 text-brand-emerald",
};

export default function Meetings() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { t } = useLanguage();

  const [filter, setFilter] = useState<FilterType>("upcoming");
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<number | null>(null);
  const [starting, setStarting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(new Date()));
  const [blockedSlots, setBlockedSlots] = useState<Set<string>>(new Set());
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set());
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [togglingSlot, setTogglingSlot] = useState<string | null>(null);
  const [gridWh, setGridWh] = useState<WorkHours>(DEFAULT_WORK_HOURS);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) setLocation("/login");
  }, [isAuthLoading, isAuthenticated, setLocation]);

  const fetchSlots = useCallback(async () => {
    setLoadingSlots(true);
    try {
      const ws = toDateStr(weekStart);
      const [blockedRes, bookedRes] = await Promise.all([
        fetch(`/api/availability?weekStart=${ws}`, { credentials: "include" }),
        fetch(`/api/availability/booked?weekStart=${ws}`, { credentials: "include" }),
      ]);
      if (blockedRes.ok) {
        const rows: { date: string; time: string }[] = await blockedRes.json();
        setBlockedSlots(new Set(rows.map(r => `${r.date}|${r.time}`)));
      }
      if (bookedRes.ok) {
        const rows: { date: string; time: string }[] = await bookedRes.json();
        setBookedSlots(new Set(rows.map(r => `${r.date}|${r.time}`)));
      }
    } catch {} finally {
      setLoadingSlots(false);
    }
  }, [weekStart]);

  useEffect(() => {
    if (isAuthenticated) fetchSlots();
  }, [isAuthenticated, fetchSlots]);

  // Load this company's Work Hours so the grid can grey out closed slots.
  // Evaluated in KSA-local time, matching the booking enforcement in
  // app/api/book/[token]. (work_hours.timezone is not yet honored — a
  // single-region assumption shared with lib/meetings/slots.ts.)
  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/settings/work-hours", { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (data?.days && data?.start && data?.end && data?.timezone) setGridWh(data as WorkHours);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  const toggleSlot = async (date: string, time: string) => {
    const key = `${date}|${time}`;
    setTogglingSlot(key);
    setBlockedSlots(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    try {
      await csrfFetch("/api/availability/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, time }),
      });
    } catch {
      setBlockedSlots(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
    } finally {
      setTogglingSlot(null);
    }
  };

  // background: skip the loading spinner so interval/refocus polls update
  // the list in place (stable row keys reconcile without flashing). The
  // spinner still shows on the initial load and on explicit filter changes.
  const fetchMeetings = useCallback(async (opts?: { background?: boolean }) => {
    if (!opts?.background) setLoading(true);
    setError(null);
    try {
      const res = await csrfFetch(`/api/meetings?filter=${filter}`, { credentials: "include" });
      if (!res.ok) throw new Error(t("meetingsErrorLoad"));
      setMeetings(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      if (!opts?.background) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMeetings();
    const interval = setInterval(() => fetchMeetings({ background: true }), 20000);
    return () => clearInterval(interval);
  }, [isAuthenticated, fetchMeetings]);

  useEffect(() => {
    const hv = () => { if (document.visibilityState === "visible" && isAuthenticated) { fetchMeetings({ background: true }); fetchSlots(); } };
    document.addEventListener("visibilitychange", hv);
    return () => document.removeEventListener("visibilitychange", hv);
  }, [fetchMeetings, fetchSlots, isAuthenticated]);

  const startMeeting = async (id: number, meetingLink: string, source: 'meeting' | 'demo' = 'meeting') => {
    window.open(meetingLink, "_blank", "noopener,noreferrer");
    setStarting(id);
    try {
      const res = await csrfFetch(`/api/meetings/${id}/start`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) throw new Error(t("meetingsErrorLoad"));
      const updated = await res.json();
      setMeetings(prev => prev.map(m => m.id === id ? { ...m, status: "in_progress", agent_name: updated.agent_name ?? m.agent_name } : m));
    } catch (e: any) { setError(e.message); } finally { setStarting(null); }
  };

  const markComplete = async (id: number, source: 'meeting' | 'demo' = 'meeting') => {
    if (!window.confirm(t("meetingsBtnMarkCompleteConfirm"))) return;
    setCompleting(id);
    try {
      const res = await csrfFetch(`/api/meetings/${id}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) throw new Error(t("meetingsErrorLoad"));
      setMeetings(prev => prev.map(m => m.id === id ? { ...m, status: "completed" } : m));
    } catch (e: any) { setError(e.message); } finally { setCompleting(null); }
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: "all", label: t("meetingsFilterAll") },
    { key: "upcoming", label: t("meetingsFilterUpcoming") },
    { key: "completed", label: t("meetingsFilterCompleted") },
  ];

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekLabel = `${weekDates[0].toLocaleDateString("en-GB",{day:"numeric",month:"short"})} – ${weekDates[6].toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}`;

  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">{t("meetingsTitle")}</h1>
            <p className="text-sm text-brand-slate mt-1">Upcoming and past meetings with customers</p>
          </div>
        </div>

        {/* Filters — pill-in-container */}
        <div className="flex gap-1 bg-white/[0.05] p-1 rounded-xl w-fit mb-6">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                filter === f.key
                  ? "bg-brand-navy shadow-sm text-white"
                  : "text-brand-slate hover:text-white/90"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 mb-4">{error}</p>
        )}

        {/* Meetings table */}
        <div className="bg-brand-navy rounded-xl border border-white/[0.08] overflow-hidden mb-10">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-6 h-6 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
            </div>
          ) : meetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-brand-slate/70 gap-2">
              <Video className="w-10 h-10 opacity-30" />
              <p className="text-sm">{t("meetingsEmpty")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] bg-white/[0.03]/60">
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-brand-slate uppercase tracking-wider">{t("meetingsColCustomer")}</th>
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-brand-slate uppercase tracking-wider">{t("meetingsColDate")}</th>
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-brand-slate uppercase tracking-wider">{t("meetingsColMeetingTime")}</th>
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-brand-slate uppercase tracking-wider">{t("meetingsColStatus")}</th>
                    <th className="text-start px-5 py-3.5 text-xs font-medium text-brand-slate uppercase tracking-wider">{t("meetingsColAgent")}</th>
                    <th className="px-5 py-3.5" />
                  </tr>
                </thead>
                <tbody>
                  {meetings.map(m => (
                    <tr key={m.id} className="border-b border-white/[0.06] last:border-b-0 hover:bg-white/[0.03]/50 transition-colors">
                      {/* Customer */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-white text-sm">
                            {m.customer_name ?? m.customer_phone ?? m.agent_name ?? "—"}
                          </span>
                          {m.source === 'demo' && (
                            <span className="inline-flex text-xs font-semibold px-2 py-0.5 rounded-full bg-brand-violet/15 text-brand-violet border border-brand-violet/30">
                              Demo
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="px-5 py-4 text-brand-slate text-sm whitespace-nowrap">
                        {m.scheduled_at ? formatDate(m.scheduled_at) : <span className="text-brand-slate/70 italic">{t("meetingsNotBooked")}</span>}
                      </td>

                      {/* Time */}
                      <td className="px-5 py-4 text-brand-slate text-sm whitespace-nowrap">
                        {m.scheduled_at ? formatTime(m.scheduled_at) : <span className="text-brand-slate/70 italic">—</span>}
                      </td>

                      {/* Status */}
                      <td className="px-5 py-4">
                        <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full ${statusBadge[m.status] ?? statusBadge.pending}`}>
                          {m.status === "completed"
                            ? t("statusCompleted")
                            : m.status === "in_progress"
                            ? t("statusInProgress")
                            : t("statusScheduled")}
                        </span>
                      </td>

                      {/* Agent */}
                      <td className="px-5 py-4 text-brand-slate text-sm">
                        {m.agent_name ?? <span className="text-brand-slate/70 italic">{t("meetingsUnassigned")}</span>}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2 flex-wrap">
                          {m.status === "pending" && (
                            <button
                              onClick={() => startMeeting(m.id, m.meeting_link, m.source ?? 'meeting')}
                              disabled={starting === m.id}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-white/90 border border-white/[0.08] bg-brand-navy px-3.5 py-2 rounded-lg hover:bg-white/[0.03] disabled:opacity-50 transition-colors"
                            >
                              <Video className="w-3.5 h-3.5" /> Join
                            </button>
                          )}
                          {m.status === "in_progress" && (
                            <button
                              onClick={() => markComplete(m.id, m.source ?? 'meeting')}
                              disabled={completing === m.id}
                              className="inline-flex items-center gap-1.5 text-xs font-medium bg-brand-blue text-white px-3.5 py-2 rounded-lg hover:bg-brand-cyan disabled:opacity-50 transition-colors"
                            >
                              Complete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Availability */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-semibold text-white">{t("meetingsManageAvailability")}</h2>
              <p className="text-xs text-brand-slate mt-1.5">{t("meetingsAvailabilityHint")}</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setWeekStart(w => addDays(w, -7))} className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.03] transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-medium text-white/90 min-w-[200px] text-center">{weekLabel}</span>
              <button onClick={() => setWeekStart(w => addDays(w, 7))} className="p-1.5 rounded-lg border border-white/[0.08] hover:bg-white/[0.03] transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="bg-brand-navy rounded-xl border border-white/[0.08] overflow-hidden">
            {loadingSlots ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-white/[0.03]/50">
                      <th className="px-3 py-2 text-start text-brand-slate font-medium w-16">{t("meetingsColTime")}</th>
                      {weekDates.map((d, i) => (
                        <th key={i} className="px-2 py-2 text-center text-brand-slate font-medium min-w-[80px]">
                          <div>{DAY_LABELS[i]}</div>
                          <div className="font-normal">{d.toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SLOT_HOURS.map(hour => (
                      <tr key={hour} className="border-t border-white/[0.06]">
                        <td className="px-3 py-2 text-brand-slate font-mono whitespace-nowrap">{hour}</td>
                        {weekDates.map((d, di) => {
                          const dateStr = toDateStr(d);
                          const key = `${dateStr}|${hour}`;
                          const isBlocked = blockedSlots.has(key);
                          const isBooked = bookedSlots.has(key);
                          const isToggling = togglingSlot === key;
                          const isClosed = !isWithinWorkHours(dateStr, hour, gridWh);
                          if (isBooked) {
                            return (
                              <td key={di} className="px-2 py-1 text-center">
                                <div title={t("meetingsSlotBookedTitle")} className="w-full h-8 rounded-md text-xs font-medium flex items-center justify-center gap-1 bg-brand-blue/15 text-brand-cyan border border-brand-cyan/30 cursor-default">
                                  <span className="hidden sm:inline">{t("meetingsSlotBooked")}</span>
                                  <span className="sm:hidden">●</span>
                                </div>
                              </td>
                            );
                          }
                          if (isClosed) {
                            // Outside this company's Work Hours: display-only and
                            // non-interactive. Booking already rejects these
                            // slots (app/api/book/[token]); this just reflects it.
                            return (
                              <td key={di} className="px-2 py-1 text-center">
                                <div
                                  aria-label="Outside work hours"
                                  className="w-full h-8 rounded-md flex items-center justify-center bg-white/[0.015] text-brand-slate/30 border border-white/[0.04] cursor-default select-none"
                                >
                                  <span className="text-[10px]">·</span>
                                </div>
                              </td>
                            );
                          }
                          return (
                            <td key={di} className="px-2 py-1 text-center">
                              <button
                                onClick={() => toggleSlot(dateStr, hour)}
                                disabled={isToggling}
                                title={isBlocked ? t("meetingsSlotClickUnblock") : t("meetingsSlotClickBlock")}
                                className={`w-full h-8 rounded-md text-xs font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-1 ${
                                  isBlocked
                                    ? "bg-red-100 text-red-400 hover:bg-red-200 border border-red-500/30"
                                    : "bg-brand-blue/10 text-brand-blue hover:bg-brand-blue/20 border border-brand-blue/20"
                                }`}
                              >
                                {isToggling ? (
                                  <div className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                                ) : isBlocked ? (
                                  <><Ban className="w-3 h-3" /><span className="hidden sm:inline">{t("meetingsSlotBlocked")}</span></>
                                ) : (
                                  <span className="hidden sm:inline">{t("meetingsSlotOpen")}</span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        {/* Work Hours */}
        <div className="mb-10">
          <WorkHoursPanel />
        </div>
      </div>
    </DashboardLayout>
  );
}
