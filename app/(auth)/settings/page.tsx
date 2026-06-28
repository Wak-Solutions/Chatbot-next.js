"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect } from "react";
import { MessageSquare, Eye, EyeOff, Check, AlertCircle, Lock, Building2, Puzzle, Users, Zap } from "lucide-react";
import DashboardLayout from "@/components/DashboardLayout";
import { useLanguage } from "@/lib/language-context";
import { csrfFetch } from "@/lib/queryClient";

/* ─────────────────────────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────────────────────────── */

interface WhatsAppCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  appSecret: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type VerifyStatus = "idle" | "verifying" | "verified" | "error";

/* ─────────────────────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────────────────────── */

function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 4) return "••••";
  return "••••••••••" + token.slice(-4);
}

const inputClass =
  "w-full px-4 py-2.5 border border-white/[0.08] rounded-xl text-sm bg-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue/40 transition-colors";

/* ─────────────────────────────────────────────────────────────────────────────
   WhatsApp Panel
───────────────────────────────────────────────────────────────────────────── */

function WhatsAppPanel({ t }: { t: (k: string) => string }) {
  const [creds, setCreds] = useState<WhatsAppCredentials>({ phoneNumberId: "", wabaId: "", accessToken: "", appSecret: "" });
  const [revealToken, setRevealToken] = useState(false);
  const [revealSecret, setRevealSecret] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>("idle");
  const [verifyError, setVerifyError] = useState("");
  const [verifiedName, setVerifiedName] = useState("");

  // Reset verified state when phone/waba/token credentials change (not appSecret —
  // verify doesn't test it, so don't invalidate verification on secret changes).
  const updateCreds = (patch: Partial<WhatsAppCredentials>) => {
    setCreds(prev => ({ ...prev, ...patch }));
    const verifyInvalidating = 'phoneNumberId' in patch || 'wabaId' in patch || 'accessToken' in patch;
    if (verifyInvalidating) {
      setVerifyStatus("idle");
      setVerifiedName("");
    }
    setSaveStatus("idle");
  };

  useEffect(() => {
    fetch("/api/settings/whatsapp", { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: WhatsAppCredentials) => setCreds(data))
      .catch(() => setLoadError(t("settingsLoadError")));
  }, []);

  const handleVerify = async () => {
    setVerifyStatus("verifying");
    setVerifyError("");
    setVerifiedName("");
    setSaveStatus("idle");
    setSaveError("");
    try {
      const resp = await csrfFetch("/api/register/whatsapp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          phoneNumberId: creds.phoneNumberId,
          wabaId: creds.wabaId,
          accessToken: creds.accessToken,
        }),
      });
      const data = await resp.json();
      if (!data.verified) {
        setVerifyStatus("error");
        setVerifyError(data.wabaError || data.error || t("settingsLoadError"));
        return;
      }
      setVerifyStatus("verified");
      setVerifiedName(data.displayName ?? "");

      // Auto-save on successful verify — no separate Save button.
      setSaveStatus("saving");
      const saveResp = await csrfFetch("/api/settings/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(creds),
      });
      if (!saveResp.ok) {
        const d = await saveResp.json().catch(() => ({}));
        throw new Error(d.message || t("settingsSaveError"));
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err: any) {
      if (verifyStatus === "verifying") {
        setVerifyStatus("error");
        setVerifyError(t("settingsLoadError"));
      } else {
        setSaveStatus("error");
        setSaveError(err.message || t("settingsSaveError"));
      }
    }
  };

  const canVerify = !!(creds.phoneNumberId && creds.wabaId && creds.accessToken);

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-100 rounded-xl p-4">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {loadError}
      </div>
    );
  }

  return (
    <div className="bg-brand-navy rounded-2xl border border-white/[0.08] overflow-hidden">
      {/* Panel header */}
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <h2 className="text-base font-semibold text-white">{t("settingsWhatsApp")}</h2>
        <p className="text-sm text-brand-slate mt-1">{t("settingsWhatsAppDesc")}</p>
      </div>

      <div className="px-6 py-6 space-y-5 max-w-lg">
        {/* Phone Number ID */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            {t("settingsPhoneNumberId")}
            <span className="text-xs text-brand-slate/70 font-normal ms-1.5">({t("settingsPhoneNumberIdHint")})</span>
          </label>
          <input
            className={inputClass}
            value={creds.phoneNumberId}
            onChange={e => updateCreds({ phoneNumberId: e.target.value })}
            placeholder="e.g. 123456789012345"
          />
        </div>

        {/* WABA ID */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            {t("settingsWabaId")}
          </label>
          <input
            className={inputClass}
            value={creds.wabaId}
            onChange={e => updateCreds({ wabaId: e.target.value })}
            placeholder="e.g. 123456789012345"
          />
        </div>

        {/* Access Token */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            {t("settingsAccessToken")}
            <span className="text-xs text-brand-slate/70 font-normal ms-1.5">({t("settingsAccessTokenHint")})</span>
          </label>
          <div className="relative">
            <input
              type={revealToken ? "text" : "password"}
              className={inputClass + " pe-24"}
              value={creds.accessToken}
              onChange={e => updateCreds({ accessToken: e.target.value })}
              placeholder={creds.accessToken ? maskToken(creds.accessToken) : "EAAx..."}
            />
            {creds.accessToken && (
              <button
                type="button"
                onClick={() => setRevealToken(v => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-brand-slate hover:text-white/90 font-medium transition-colors"
              >
                {revealToken
                  ? <><EyeOff className="w-3.5 h-3.5" />{t("settingsHide")}</>
                  : <><Eye className="w-3.5 h-3.5" />{t("settingsReveal")}</>
                }
              </button>
            )}
          </div>
        </div>

        {/* App Secret */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            App Secret
            <span className="text-xs text-brand-slate/70 font-normal ms-1.5">(Meta Developer → App Settings → Basic → App Secret)</span>
          </label>
          <div className="relative">
            <input
              type={revealSecret ? "text" : "password"}
              className={inputClass + " pe-24"}
              value={creds.appSecret}
              onChange={e => updateCreds({ appSecret: e.target.value })}
              placeholder={creds.appSecret ? maskToken(creds.appSecret) : "32-char hex string"}
            />
            {creds.appSecret && (
              <button
                type="button"
                onClick={() => setRevealSecret(v => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-brand-slate hover:text-white/90 font-medium transition-colors"
              >
                {revealSecret
                  ? <><EyeOff className="w-3.5 h-3.5" />{t("settingsHide")}</>
                  : <><Eye className="w-3.5 h-3.5" />{t("settingsReveal")}</>
                }
              </button>
            )}
          </div>
          <p className="text-xs text-brand-amber mt-1.5">Required for Meta to send messages to your bot. Without this, the signature check will reject all incoming messages.</p>
        </div>

        {/* Verify row */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleVerify}
            disabled={!canVerify || verifyStatus === "verifying"}
            className="inline-flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-brand-cyan transition-colors"
          >
            {verifyStatus === "verifying" ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("settingsVerifying")}</>
            ) : verifyStatus === "verified" ? (
              <><Check className="w-4 h-4" />{t("settingsVerified")}</>
            ) : (
              t("settingsVerify")
            )}
          </button>
          {verifyStatus === "verified" && verifiedName && (
            <span className="text-sm text-brand-emerald font-medium">{verifiedName}</span>
          )}
          {verifyStatus === "error" && (
            <span className="text-sm text-red-400">{verifyError}</span>
          )}
          {saveStatus === "saving" && (
            <span className="text-sm text-brand-slate inline-flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-white/[0.10] border-t-gray-700 rounded-full animate-spin" />
              {t("settingsSaving")}
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-sm text-brand-emerald font-medium inline-flex items-center gap-1">
              <Check className="w-4 h-4" />{t("settingsSaved")}
            </span>
          )}
          {saveStatus === "error" && saveError && (
            <span className="text-sm text-red-400">{saveError}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Gupshup Panel
───────────────────────────────────────────────────────────────────────────── */

interface GupshupCredentials {
  appName: string;
  sourceNumber: string;
  apiKey: string;
}

function GupshupPanel({ t }: { t: (k: string) => string }) {
  const [creds, setCreds] = useState<GupshupCredentials>({ appName: "", sourceNumber: "", apiKey: "" });
  const [revealKey, setRevealKey] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");

  const updateCreds = (patch: Partial<GupshupCredentials>) => {
    setCreds(prev => ({ ...prev, ...patch }));
    setSaveStatus("idle");
  };

  useEffect(() => {
    fetch("/api/settings/gupshup", { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: GupshupCredentials) => setCreds(data))
      .catch(() => setLoadError(t("settingsLoadError")));
  }, []);

  const canSave = !!(creds.appName && creds.sourceNumber);

  const handleSave = async () => {
    setSaveStatus("saving");
    setSaveError("");
    try {
      const resp = await csrfFetch("/api/settings/gupshup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(creds),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.message || t("settingsSaveError"));
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err: any) {
      setSaveStatus("error");
      setSaveError(err.message || t("settingsSaveError"));
    }
  };

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-100 rounded-xl p-4">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {loadError}
      </div>
    );
  }

  return (
    <div className="bg-brand-navy rounded-2xl border border-white/[0.08] overflow-hidden">
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <h2 className="text-base font-semibold text-white">{t("settingsGupshup")}</h2>
        <p className="text-sm text-brand-slate mt-1">{t("settingsGupshupDesc")}</p>
      </div>

      <div className="px-6 py-6 space-y-5 max-w-lg">
        {/* App Name */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            {t("settingsGupshupAppName")}
            <span className="text-xs text-brand-slate/70 font-normal ms-1.5">({t("settingsGupshupAppNameHint")})</span>
          </label>
          <input
            className={inputClass}
            value={creds.appName}
            onChange={e => updateCreds({ appName: e.target.value })}
            placeholder="e.g. MyCompanyBot"
          />
        </div>

        {/* Source Number */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            {t("settingsGupshupSource")}
            <span className="text-xs text-brand-slate/70 font-normal ms-1.5">({t("settingsGupshupSourceHint")})</span>
          </label>
          <input
            className={inputClass}
            value={creds.sourceNumber}
            onChange={e => updateCreds({ sourceNumber: e.target.value })}
            placeholder="e.g. 919876543210"
          />
        </div>

        {/* API Key */}
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            {t("settingsGupshupApiKey")}
            <span className="text-xs text-brand-slate/70 font-normal ms-1.5">({t("settingsGupshupApiKeyHint")})</span>
          </label>
          <div className="relative">
            <input
              type={revealKey ? "text" : "password"}
              className={inputClass + " pe-24"}
              value={creds.apiKey}
              onChange={e => updateCreds({ apiKey: e.target.value })}
              placeholder={creds.apiKey ? maskToken(creds.apiKey) : "sk_..."}
            />
            {creds.apiKey && (
              <button
                type="button"
                onClick={() => setRevealKey(v => !v)}
                className="absolute end-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs text-brand-slate hover:text-white/90 font-medium transition-colors"
              >
                {revealKey
                  ? <><EyeOff className="w-3.5 h-3.5" />{t("settingsHide")}</>
                  : <><Eye className="w-3.5 h-3.5" />{t("settingsReveal")}</>
                }
              </button>
            )}
          </div>
          <p className="text-xs text-brand-amber mt-1.5">{t("settingsGupshupApiKeyWarn")}</p>
        </div>

        {/* Save row */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || saveStatus === "saving"}
            className="inline-flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-brand-cyan transition-colors"
          >
            {saveStatus === "saving" ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("settingsSaving")}</>
            ) : (
              t("settingsSave")
            )}
          </button>
          {saveStatus === "saved" && (
            <span className="text-sm text-brand-emerald font-medium inline-flex items-center gap-1">
              <Check className="w-4 h-4" />{t("settingsSaved")}
            </span>
          )}
          {saveStatus === "error" && saveError && (
            <span className="text-sm text-red-400">{saveError}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Branding Panel
───────────────────────────────────────────────────────────────────────────── */

function BrandingPanel({ t }: { t: (k: string) => string }) {
  const [brandName, setBrandName] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    fetch("/api/settings/branding", { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { brandName: string }) => {
        setBrandName(data.brandName || "");
      })
      .catch(() => setLoadError(t("settingsLoadError")));
  }, []);

  const handleSave = async () => {
    setSaveError("");
    setSaveStatus("saving");
    try {
      const resp = await csrfFetch("/api/settings/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ brandName }),
      });
      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        throw new Error(d.message || t("settingsSaveError"));
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (err: any) {
      setSaveStatus("error");
      setSaveError(err.message || t("settingsSaveError"));
    }
  };

  const canSave = !!brandName.trim() && saveStatus !== "saving";

  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-100 rounded-xl p-4">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {loadError}
      </div>
    );
  }

  return (
    <div className="bg-brand-navy rounded-2xl border border-white/[0.08] overflow-hidden">
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <h2 className="text-base font-semibold text-white">{t("settingsBranding")}</h2>
        <p className="text-sm text-brand-slate mt-1">{t("settingsBrandingDesc")}</p>
      </div>

      <div className="px-6 py-6 space-y-5 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            {t("settingsBrandName")}
          </label>
          <input
            className={inputClass}
            value={brandName}
            onChange={e => { setBrandName(e.target.value); setSaveStatus("idle"); }}
            placeholder="e.g. Acme Corp"
          />
          <p className="text-xs text-brand-slate/70 mt-1">{t("settingsBrandNameHint")}</p>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="inline-flex items-center gap-2 bg-brand-blue text-white px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40 hover:bg-brand-cyan transition-colors"
          >
            {saveStatus === "saving" ? (
              <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("settingsSaving")}</>
            ) : saveStatus === "saved" ? (
              <><Check className="w-4 h-4" />{t("settingsSaved")}</>
            ) : (
              t("settingsSave")
            )}
          </button>
          {saveStatus === "error" && saveError && (
            <span className="text-sm text-red-400">{saveError}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Assignment Panel
───────────────────────────────────────────────────────────────────────────── */

function AssignmentPanel({ t }: { t: (k: string) => string }) {
  const [autoAssign, setAutoAssign] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/assignment", { credentials: "include" })
      .then(r => r.ok ? r.json() : { autoAssign: false })
      .then(d => setAutoAssign(Boolean(d.autoAssign)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const update = async (next: boolean) => {
    if (next === autoAssign) return;
    setSaving(true);
    setAutoAssign(next); // optimistic
    try {
      const r = await csrfFetch("/api/settings/assignment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ autoAssign: next }),
      });
      if (!r.ok) setAutoAssign(!next);
    } catch {
      setAutoAssign(!next);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  const Option = ({ value, title, desc }: { value: boolean; title: string; desc: string }) => {
    const selected = autoAssign === value;
    return (
      <button
        type="button"
        onClick={() => update(value)}
        disabled={saving}
        className={`w-full text-start rounded-xl border p-4 transition-colors disabled:opacity-60 ${
          selected ? "border-brand-blue bg-brand-blue/[0.07]" : "border-white/[0.08] hover:border-white/20"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${selected ? "border-brand-blue" : "border-white/30"}`}>
            {selected && <span className="w-2 h-2 rounded-full bg-brand-blue" />}
          </span>
          <span className="text-sm font-semibold text-white">{title}</span>
        </div>
        <p className="text-[13px] text-brand-slate mt-1 ms-6">{desc}</p>
      </button>
    );
  };

  return (
    <div className="bg-brand-navy rounded-2xl border border-white/[0.08] overflow-hidden">
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <h2 className="text-base font-semibold text-white">{t("settingsAssignment")}</h2>
        <p className="text-sm text-brand-slate mt-1">{t("settingsAssignmentDesc")}</p>
      </div>
      <div className="px-6 py-6 space-y-3 max-w-lg">
        <Option value={false} title={t("settingsAssignmentManual")} desc={t("settingsAssignmentManualDesc")} />
        <Option value={true} title={t("settingsAssignmentAuto")} desc={t("settingsAssignmentAutoDesc")} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Settings Sections (left nav)
───────────────────────────────────────────────────────────────────────────── */

type SectionId = "whatsapp" | "gupshup" | "bcrumbs" | "assignment" | "branding" | "password";

interface Section {
  id: SectionId;
  icon: React.ReactNode;
  labelKey: string;
}

const SECTIONS: Section[] = [
  { id: "whatsapp", icon: <MessageSquare className="w-4 h-4" />, labelKey: "settingsWhatsApp" },
  { id: "gupshup", icon: <Zap className="w-4 h-4" />, labelKey: "settingsGupshup" },
  { id: "bcrumbs", icon: <Puzzle className="w-4 h-4" />, labelKey: "settingsBcrumbs" },
  { id: "assignment", icon: <Users className="w-4 h-4" />, labelKey: "settingsAssignment" },
  { id: "branding", icon: <Building2 className="w-4 h-4" />, labelKey: "settingsBranding" },
  { id: "password", icon: <Lock className="w-4 h-4" />, labelKey: "settingsChangePassword" },
];

/* ─────────────────────────────────────────────────────────────────────────────
   Bread Crumbs Panel
───────────────────────────────────────────────────────────────────────────── */

function BcrumbsPanel({ t }: { t: (k: string) => string }) {
  const [workspaceId, setWorkspaceId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/bcrumbs", { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((data: { workspaceId: string }) => setWorkspaceId(data.workspaceId ?? ""))
      .catch(() => setLoadError(t("settingsLoadError")))
      .finally(() => setLoading(false));
  }, [t]);

  const handleSave = async () => {
    setStatus("saving");
    setError("");
    try {
      const resp = await csrfFetch("/api/settings/bcrumbs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ workspaceId: workspaceId.trim() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStatus("error");
        setError(data.message || t("settingsSaveError"));
        return;
      }
      setStatus("saved");
    } catch {
      setStatus("error");
      setError(t("settingsSaveError"));
    }
  };

  if (loading) return null;
  if (loadError) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400 bg-red-500/10 border border-red-100 rounded-xl p-4">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {loadError}
      </div>
    );
  }

  return (
    <div className="bg-brand-navy rounded-2xl border border-white/[0.08] overflow-hidden">
      <div className="px-6 py-5 border-b border-white/[0.06]">
        <h2 className="text-base font-semibold text-white">{t("settingsBcrumbs")}</h2>
        <p className="text-sm text-brand-slate mt-1">{t("settingsBcrumbsDesc")}</p>
      </div>

      <div className="px-6 py-6 space-y-5 max-w-lg">
        <div>
          <label className="block text-sm font-medium text-white/90 mb-1.5">
            {t("settingsWorkspaceId")}
            <span className="text-xs text-brand-slate/70 font-normal ms-1.5">({t("settingsWorkspaceIdHint")})</span>
          </label>
          <input
            className={inputClass}
            value={workspaceId}
            onChange={e => { setWorkspaceId(e.target.value); setStatus("idle"); setError(""); }}
            placeholder="e.g. a1b2c3d4-e5f6-7890"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {status === "saved" && (
          <div className="flex items-center gap-2 bg-brand-emerald/10 border border-brand-emerald/30 text-brand-emerald text-sm rounded-lg px-3 py-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{t("settingsSaved")}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={!workspaceId.trim() || status === "saving"}
          className="bg-brand-blue text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-cyan disabled:opacity-50 transition-colors"
        >
          {status === "saving" ? t("settingsSaving") : t("settingsSave")}
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Change Password Panel
───────────────────────────────────────────────────────────────────────────── */

function ChangePasswordPanel({ t }: { t: (k: string) => string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const canSubmit =
    currentPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    newPassword !== currentPassword &&
    status !== "saving";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) { setError(t("settingsPasswordTooShort")); return; }
    if (newPassword !== confirmPassword) { setError(t("settingsPasswordMismatch")); return; }
    if (newPassword === currentPassword) { setError(t("settingsPasswordSameAsOld")); return; }

    setStatus("saving");
    try {
      const resp = await csrfFetch("/api/settings/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setStatus("error");
        setError(data.message || t("settingsPasswordError"));
        return;
      }
      setStatus("saved");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setStatus("error");
      setError(t("settingsPasswordError"));
    }
  };

  return (
    <section className="bg-brand-navy border border-white/[0.08] rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand-blue/10 flex items-center justify-center">
          <Lock className="w-5 h-5 text-brand-blue" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">{t("settingsChangePassword")}</h2>
          <p className="text-xs text-brand-slate mt-0.5">{t("settingsChangePasswordSub")}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
        <div>
          <label className="text-xs font-medium text-white/90 mb-1.5 block">{t("settingsCurrentPassword")}</label>
          <div className="relative">
            <input
              type={showCurrent ? "text" : "password"}
              value={currentPassword}
              onChange={e => { setCurrentPassword(e.target.value); setStatus("idle"); setError(""); }}
              autoComplete="current-password"
              className={inputClass}
            />
            <button type="button" onClick={() => setShowCurrent(s => !s)} className="absolute end-3 top-1/2 -translate-y-1/2 text-brand-slate/70 hover:text-brand-slate">
              {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-white/90 mb-1.5 block">{t("settingsNewPassword")}</label>
          <div className="relative">
            <input
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={e => { setNewPassword(e.target.value); setStatus("idle"); setError(""); }}
              autoComplete="new-password"
              className={inputClass}
            />
            <button type="button" onClick={() => setShowNew(s => !s)} className="absolute end-3 top-1/2 -translate-y-1/2 text-brand-slate/70 hover:text-brand-slate">
              {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[11px] text-brand-slate mt-1">{t("settingsPasswordHint")}</p>
        </div>
        <div>
          <label className="text-xs font-medium text-white/90 mb-1.5 block">{t("settingsConfirmPassword")}</label>
          <input
            type={showNew ? "text" : "password"}
            value={confirmPassword}
            onChange={e => { setConfirmPassword(e.target.value); setStatus("idle"); setError(""); }}
            autoComplete="new-password"
            className={inputClass}
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        {status === "saved" && (
          <div className="flex items-center gap-2 bg-brand-emerald/10 border border-brand-emerald/30 text-brand-emerald text-sm rounded-lg px-3 py-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{t("settingsPasswordUpdated")}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="bg-brand-blue text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-cyan disabled:opacity-50 transition-colors"
        >
          {status === "saving" ? t("settingsPasswordSaving") : t("settingsChangePassword")}
        </button>
      </form>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   Page
───────────────────────────────────────────────────────────────────────────── */

function BrandingWarningBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch("/api/settings/branding", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((data: { brandName: string } | null) => {
        if (data && !data.brandName) setShow(true);
      })
      .catch(() => {});
  }, []);

  if (!show) return null;
  return (
    <div className="mb-6 bg-brand-amber/15 border border-brand-amber/30 rounded-lg px-4 py-3 text-sm text-amber-800 flex items-center gap-2">
      <span>⚠</span>
      <span>Please set your Brand Name in Settings → Branding.</span>
    </div>
  );
}

export default function SettingsPage() {
  const { t: rawT, lang } = useLanguage();
  const t = rawT as unknown as (key: string) => string;
  const isRtl = lang === "ar";
  const [activeSection, setActiveSection] = useState<SectionId>("whatsapp");

  return (
    <DashboardLayout>
      <div dir={isRtl ? "rtl" : "ltr"} className="max-w-5xl mx-auto">
        {/* Page title */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">{t("settings")}</h1>
        </div>
        <BrandingWarningBanner />

        <div className="flex gap-6 items-start">
          {/* Left section nav */}
          <nav className="w-44 shrink-0">
            <ul className="space-y-0.5">
              {SECTIONS.map(s => (
                <li key={s.id}>
                  <button
                    onClick={() => setActiveSection(s.id)}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors text-start ${
                      activeSection === s.id
                        ? "bg-brand-blue/10 text-brand-blue"
                        : "text-brand-slate hover:bg-white/[0.05] hover:text-white"
                    }`}
                  >
                    <span className={activeSection === s.id ? "text-brand-blue" : "text-brand-slate/70"}>
                      {s.icon}
                    </span>
                    {t(s.labelKey)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Right panel */}
          <div className="flex-1 min-w-0">
            {activeSection === "whatsapp" && <WhatsAppPanel t={t} />}
            {activeSection === "gupshup" && <GupshupPanel t={t} />}
            {activeSection === "bcrumbs" && <BcrumbsPanel t={t} />}
            {activeSection === "assignment" && <AssignmentPanel t={t} />}
            {activeSection === "branding" && <BrandingPanel t={t} />}
            {activeSection === "password" && <ChangePasswordPanel t={t} />}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
