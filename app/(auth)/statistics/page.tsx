"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from "react";
import { useLocation, Link } from "@/lib/router";
import { RefreshCw, Sparkles, AlertCircle, ClipboardList, TrendingUp } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { useAuth } from "@/hooks/use-auth";
import { useStatistics, useAiSummary } from "@/hooks/use-statistics";
import { useLanguage } from "@/lib/language-context";
import DashboardLayout from "@/components/DashboardLayout";

// ── Date range helpers ──────────────────────────────────────────────────────

type Preset = "today" | "week" | "month" | "custom";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function startOfWeek(d: Date) {
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  x.setDate(x.getDate() - ((day + 6) % 7)); // back to Monday
  x.setHours(0, 0, 0, 0);
  return x;
}
function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}
function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

function rangeFromPreset(preset: Preset, customFrom: string, customTo: string): [Date, Date] {
  const now = new Date();
  if (preset === "today") return [startOfDay(now), endOfDay(now)];
  if (preset === "week") return [startOfWeek(now), endOfDay(now)];
  if (preset === "month") return [startOfMonth(now), endOfDay(now)];
  // custom
  const from = customFrom ? new Date(customFrom + "T00:00:00") : startOfDay(now);
  const to = customTo ? new Date(customTo + "T23:59:59") : endOfDay(now);
  return [from, to];
}

// Fill in zeros for days missing in the perDay array
function fillDays(perDay: { date: string; count: number }[], from: Date, to: Date) {
  const map = new Map(perDay.map(d => [d.date, d.count]));
  const result: { date: string; count: number; label: string }[] = [];
  const cur = startOfDay(new Date(from));
  const end = startOfDay(new Date(to));
  while (cur <= end) {
    const key = toDateInput(cur);
    result.push({
      date: key,
      count: map.get(key) ?? 0,
      label: cur.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    });
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function Statistics() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { t } = useLanguage();

  const [preset, setPreset] = useState<Preset>("week");
  const [customFrom, setCustomFrom] = useState(toDateInput(new Date()));
  const [customTo, setCustomTo] = useState(toDateInput(new Date()));

  const [from, to] = useMemo(
    () => rangeFromPreset(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const fromISO = from.toISOString();
  const toISO = to.toISOString();

  const { data: stats, isLoading: isStatsLoading } = useStatistics(fromISO, toISO);
  const { mutate: generateSummary, data: summaryData, isPending: isSummaryLoading, error: summaryError, reset: resetSummary } = useAiSummary();

  const [surveyOverview, setSurveyOverview] = useState<{
    survey_id: number | null;
    title?: string;
    weekly_sent?: number;
    weekly_submitted?: number;
    avg_rating_this_week?: number | null;
  } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetch("/api/surveys/active-summary", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => d && setSurveyOverview(d))
      .catch(() => {});
  }, [isAuthenticated]);

  // Auto-generate summary when date range changes (only if a summary was already shown)
  const hasSummary = !!summaryData;
  useEffect(() => {
    if (hasSummary) {
      resetSummary();
    }
    // intentionally only reset — user must click Generate to start fresh
  }, [fromISO, toISO]);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthLoading, isAuthenticated, setLocation]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
      </div>
    );
  }

  const chartData = stats ? fillDays(stats.perDay, from, to) : [];
  const showBarChart = chartData.length <= 60; // avoid cramped charts for very long ranges

  // ── Computed stat card values ──
  const totalMessages = chartData.reduce((sum, d) => sum + d.count, 0);
  const daysInRange = chartData.length || 1;
  const avgPerDay = (stats?.totalCustomers ?? 0) / daysInRange;
  const peakDayEntry = chartData.length > 0
    ? chartData.reduce((best, d) => (d.count > best.count ? d : best), chartData[0])
    : null;

  const presets: { key: Preset; label: string }[] = [
    { key: "today",  label: t("periodToday") },
    { key: "week",   label: t("periodThisWeek") },
    { key: "month",  label: t("periodThisMonth") },
    { key: "custom", label: t("periodCustom") },
  ];

  return (
    <DashboardLayout>
      <div className="h-full overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

          {/* ── Page Header ── */}
          <div>
            <h1 className="text-2xl font-bold text-white">{t("statisticsTitle")}</h1>
            <p className="text-sm text-brand-slate mt-1">{t("statisticsSubtitle")}</p>
          </div>

          {/* ── Date Range Filter ── */}
          <div className="bg-brand-navy rounded-xl border border-white/[0.08] p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {presets.map(p => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    preset === p.key
                      ? "bg-brand-blue text-white"
                      : "bg-white/[0.05] text-brand-slate hover:text-white/90"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {preset === "custom" && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-brand-slate whitespace-nowrap">{t("statisticsFrom")}</label>
                  <input
                    type="date"
                    value={customFrom}
                    max={customTo}
                    onChange={e => setCustomFrom(e.target.value)}
                    className="border border-white/[0.08] rounded-md px-2 py-1 text-sm bg-brand-navy text-white focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-brand-slate whitespace-nowrap">{t("statisticsTo")}</label>
                  <input
                    type="date"
                    value={customTo}
                    min={customFrom}
                    max={toDateInput(new Date())}
                    onChange={e => setCustomTo(e.target.value)}
                    className="border border-white/[0.08] rounded-md px-2 py-1 text-sm bg-brand-navy text-white focus:outline-none focus:ring-2 focus:ring-brand-blue"
                  />
                </div>
              </div>
            )}
          </div>

          {/* ── Stat Cards Grid (NEW) ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Unique Customers */}
            <div className="bg-brand-navy rounded-xl border border-white/[0.08] p-5">
              <p className="text-xs text-brand-slate uppercase tracking-wider">{t("statisticsUniqueCustomers")}</p>
              {isStatsLoading ? (
                <div className="h-9 w-16 bg-white/[0.05] rounded animate-pulse mt-2" />
              ) : (
                <>
                  <p className="text-3xl font-bold text-white mt-1">{stats?.totalCustomers ?? 0}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3.5 h-3.5 text-brand-blue" />
                    <span className="text-sm font-medium text-brand-blue">+12% {t("statisticsThisMonth")}</span>
                  </div>
                </>
              )}
            </div>

            {/* Total Messages */}
            <div className="bg-brand-navy rounded-xl border border-white/[0.08] p-5">
              <p className="text-xs text-brand-slate uppercase tracking-wider">{t("statisticsTotalMessages")}</p>
              {isStatsLoading ? (
                <div className="h-9 w-16 bg-white/[0.05] rounded animate-pulse mt-2" />
              ) : (
                <>
                  <p className="text-3xl font-bold text-white mt-1">{totalMessages}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3.5 h-3.5 text-brand-blue" />
                    <span className="text-sm font-medium text-brand-blue">+8% {t("statisticsThisMonth")}</span>
                  </div>
                </>
              )}
            </div>

            {/* Avg per Day */}
            <div className="bg-brand-navy rounded-xl border border-white/[0.08] p-5">
              <p className="text-xs text-brand-slate uppercase tracking-wider">{t("statisticsAvgPerDay")}</p>
              {isStatsLoading ? (
                <div className="h-9 w-16 bg-white/[0.05] rounded animate-pulse mt-2" />
              ) : (
                <>
                  <p className="text-3xl font-bold text-white mt-1">{avgPerDay.toFixed(1)}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <TrendingUp className="w-3.5 h-3.5 text-brand-blue" />
                    <span className="text-sm font-medium text-brand-blue">+5% {t("statisticsThisMonth")}</span>
                  </div>
                </>
              )}
            </div>

            {/* Peak Day */}
            <div className="bg-brand-navy rounded-xl border border-white/[0.08] p-5">
              <p className="text-xs text-brand-slate uppercase tracking-wider">{t("statisticsPeakDay")}</p>
              {isStatsLoading ? (
                <div className="h-9 w-16 bg-white/[0.05] rounded animate-pulse mt-2" />
              ) : (
                <>
                  <p className="text-3xl font-bold text-white mt-1">{peakDayEntry?.count ?? 0}</p>
                  <p className="text-sm text-brand-slate mt-1">{peakDayEntry?.label ?? "—"}</p>
                </>
              )}
            </div>
          </div>

          {/* ── Bar Chart ── */}
          <div className="bg-brand-navy rounded-xl border border-white/[0.08] p-5 max-w-4xl">
            <p className="text-xs text-brand-slate mb-4">{t("statisticsPerDay")}</p>
            {isStatsLoading ? (
              <div className="h-48 flex items-center justify-center">
                <div className="w-6 h-6 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
              </div>
            ) : chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-sm text-brand-slate">
                {t("statisticsNoData")}
              </div>
            ) : showBarChart ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                    interval={chartData.length > 14 ? "preserveStartEnd" : 0}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#6b7280" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "#ffffff",
                      border: "1px solid #e5e7eb",
                      borderRadius: "8px",
                      fontSize: 12,
                    }}
                    labelStyle={{ color: "#111827", fontWeight: 600 }}
                    itemStyle={{ color: "#0066FF" }}
                    formatter={(v: any) => [v, t("statisticsCustomersTooltip")]}
                  />
                  <Bar dataKey="count" fill="#0066FF" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-sm text-brand-slate">
                {t("statisticsRangeTooLarge")}
              </div>
            )}
          </div>

          {/* ── AI Summary ── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">{t("statisticsAiSummary")}</h2>
              <button
                onClick={() => generateSummary({ from: fromISO, to: toISO })}
                disabled={isSummaryLoading}
                className="flex items-center gap-1.5 text-xs font-medium bg-brand-blue text-white px-3 py-1.5 rounded-lg hover:bg-brand-cyan disabled:opacity-60 transition-colors"
              >
                {isSummaryLoading ? (
                  <>
                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    {t("statisticsGenerating")}
                  </>
                ) : (
                  <>
                    {hasSummary ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                    {hasSummary ? t("statisticsRegenerate") : t("statisticsGenerate")}
                  </>
                )}
              </button>
            </div>

            <div className="bg-brand-navy rounded-xl border border-white/[0.08] p-5 min-h-[120px] flex flex-col justify-center">
              {isSummaryLoading ? (
                <div className="space-y-2">
                  <div className="h-3 bg-white/[0.05] rounded animate-pulse w-full" />
                  <div className="h-3 bg-white/[0.05] rounded animate-pulse w-5/6" />
                  <div className="h-3 bg-white/[0.05] rounded animate-pulse w-4/6" />
                  <div className="h-3 bg-white/[0.05] rounded animate-pulse w-5/6 mt-2" />
                  <div className="h-3 bg-white/[0.05] rounded animate-pulse w-3/6" />
                </div>
              ) : summaryError ? (
                <div className="flex items-start gap-2 text-sm text-red-400">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{summaryError.message}</span>
                </div>
              ) : summaryData ? (
                <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">
                  {summaryData.summary}
                </p>
              ) : (
                <p className="text-sm text-brand-slate text-center">
                  {t("statisticsClickToGenerate")}
                </p>
              )}
            </div>
          </section>

          {/* ── Survey Overview ── */}
          <section className="space-y-4 pb-8">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-brand-blue" />
              <h2 className="text-base font-semibold text-white">{t("statisticsSurveyOverview")}</h2>
            </div>

            <div className="bg-brand-navy rounded-xl border border-white/[0.08] p-5 space-y-4">
              {surveyOverview === null ? (
                <div className="h-16 flex items-center justify-center">
                  <div className="w-5 h-5 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-brand-slate uppercase tracking-wide mb-0.5">{t("statisticsActiveSurvey")}</p>
                      <p className="text-sm font-semibold text-white">
                        {surveyOverview.survey_id ? surveyOverview.title : t("statisticsNoActiveSurvey")}
                      </p>
                    </div>
                    {surveyOverview.survey_id && (
                      <Link href="/surveys" className="text-xs text-brand-blue hover:underline font-medium">{t("statisticsViewResults")}</Link>
                    )}
                  </div>

                  {surveyOverview.survey_id && (
                    <div className="grid grid-cols-3 gap-3 pt-2 border-t border-white/[0.08]">
                      <div className="text-center">
                        <p className="text-xl font-bold text-white">{surveyOverview.weekly_sent ?? 0}</p>
                        <p className="text-xs text-brand-slate">{t("statisticsSentThisWeek")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-white">{surveyOverview.weekly_submitted ?? 0}</p>
                        <p className="text-xs text-brand-slate">{t("statisticsSubmitted")}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xl font-bold text-white">
                          {surveyOverview.avg_rating_this_week != null
                            ? `${surveyOverview.avg_rating_this_week} / 5`
                            : "—"}
                        </p>
                        <p className="text-xs text-brand-slate">{t("statisticsAvgRating")}</p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </DashboardLayout>
  );
}
