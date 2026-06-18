"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "@/lib/router";
import { Infinity as InfinityIcon, Plus, Check } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import DashboardLayout from "@/components/DashboardLayout";
import { csrfFetch } from "@/lib/queryClient";

interface CompanyRow {
  id: number;
  name: string | null;
  email: string | null;
  createdAt: string | null;
  subscriptionEndsAt: string | null;
  unlimited: boolean;
  expiresAt: string | null;
  expired: boolean;
  daysRemaining: number | null;
  agentCount: number;
}

interface CompaniesResponse {
  trialDays: number;
  companies: CompanyRow[];
}

type SubscriptionAction =
  | { action: "extend"; days: number }
  | { action: "unlimited"; unlimited: boolean };

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function StatusBadge({ c }: { c: CompanyRow }) {
  if (c.unlimited) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-blue/15 text-brand-blue border border-brand-blue/30">
        <InfinityIcon className="w-3 h-3" /> Unlimited
      </span>
    );
  }
  if (c.expired) {
    return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/15 text-red-400 border border-red-500/30">Expired</span>;
  }
  const days = c.daysRemaining ?? 0;
  const color = days <= 3 ? "bg-brand-amber/15 text-brand-amber border-brand-amber/30" : "bg-brand-emerald/15 text-brand-emerald border-brand-emerald/30";
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${color}`}>{days}d left</span>;
}

function CompanyRowItem({ company }: { company: CompanyRow }) {
  const queryClient = useQueryClient();
  const [days, setDays] = useState(30);

  const mutation = useMutation({
    mutationFn: async (body: SubscriptionAction) => {
      const res = await csrfFetch(`/api/admin/companies/${company.id}/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/companies"] }),
  });

  const busy = mutation.isPending;

  return (
    <tr className="border-b border-white/[0.06] hover:bg-white/[0.02]">
      <td className="px-4 py-3 text-sm text-white/90">
        <div className="font-medium">{company.name || `Company #${company.id}`}</div>
        <div className="text-xs text-brand-slate">{company.email || "no email"} · {company.agentCount} agent{company.agentCount === 1 ? "" : "s"}</div>
      </td>
      <td className="px-4 py-3"><StatusBadge c={company} /></td>
      <td className="px-4 py-3 text-sm text-brand-slate">{company.unlimited ? "—" : fmtDate(company.expiresAt)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 justify-end">
          <input
            type="number"
            min={1}
            max={3650}
            value={days}
            onChange={e => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
            disabled={busy || company.unlimited}
            className="w-16 px-2 py-1.5 text-sm rounded-lg bg-brand-navy border border-white/[0.08] text-white/90 focus:outline-none focus:border-brand-blue/40 disabled:opacity-40"
          />
          <button
            onClick={() => mutation.mutate({ action: "extend", days })}
            disabled={busy || company.unlimited}
            className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-brand-blue/10 text-brand-blue border border-brand-blue/30 hover:bg-brand-blue/20 transition-colors disabled:opacity-40"
          >
            <Plus className="w-3 h-3" /> Extend
          </button>
          <button
            onClick={() => mutation.mutate({ action: "unlimited", unlimited: !company.unlimited })}
            disabled={busy}
            className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
              company.unlimited
                ? "bg-white/[0.04] text-brand-slate border-white/[0.08] hover:bg-white/[0.08]"
                : "bg-brand-blue/10 text-brand-blue border-brand-blue/30 hover:bg-brand-blue/20"
            }`}
          >
            {company.unlimited ? <><Check className="w-3 h-3" /> Unlimited</> : <><InfinityIcon className="w-3 h-3" /> Set unlimited</>}
          </button>
        </div>
      </td>
    </tr>
  );
}

export default function AdminSubscriptions() {
  const { isLoading: authLoading, isAdmin, companyId } = useAuth();
  const [, setLocation] = useLocation();
  const isPlatformOwner = isAdmin && companyId === 1;

  // Non-platform-owners have no business here — bounce them. The server
  // also enforces this (withPlatformAdmin) so the API is safe regardless.
  useEffect(() => {
    if (!authLoading && !isPlatformOwner) setLocation("/dashboard");
  }, [authLoading, isPlatformOwner, setLocation]);

  const { data, isLoading, error } = useQuery<CompaniesResponse>({
    queryKey: ["/api/admin/companies"],
    enabled: isPlatformOwner,
    staleTime: 30 * 1000,
  });

  return (
    <DashboardLayout>
      <div className="p-6 max-w-5xl mx-auto w-full">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-white">Subscriptions</h1>
          <p className="text-sm text-brand-slate mt-1">
            Extend or grant access for any tenant. Trial length is {data?.trialDays ?? 14} days; extending pushes the access-until date out.
          </p>
        </div>

        {isLoading && <div className="text-sm text-brand-slate">Loading…</div>}
        {error && <div className="text-sm text-red-400">Failed to load companies.</div>}

        {data && (
          <div className="rounded-2xl border border-white/[0.08] bg-brand-navy overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.08] text-left">
                  <th className="px-4 py-3 text-xs font-semibold text-brand-slate uppercase tracking-wide">Company</th>
                  <th className="px-4 py-3 text-xs font-semibold text-brand-slate uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-brand-slate uppercase tracking-wide">Access until</th>
                  <th className="px-4 py-3 text-xs font-semibold text-brand-slate uppercase tracking-wide text-end">Manage</th>
                </tr>
              </thead>
              <tbody>
                {data.companies.map(c => <CompanyRowItem key={c.id} company={c} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
