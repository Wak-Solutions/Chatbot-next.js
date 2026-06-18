"use client";

export const dynamic = 'force-dynamic';

import { useState } from "react";
import { useLocation } from "@/lib/router";
import { Lock, Mail, ArrowLeft } from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/contracts/routes";
import { csrfFetch } from "@/lib/queryClient";
import { Logo } from "@/components/ui/Logo";
import { signIn } from "next-auth/react";

export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [showTermsModal, setShowTermsModal] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const [termsAccepting, setTermsAccepting] = useState(false);
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState("");
  const [forgotStatus, setForgotStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [forgotError, setForgotError] = useState("");
  const { t, lang } = useLanguage();
  const isRtl = lang === "ar";

  const handleAcceptTerms = async () => {
    setTermsAccepting(true);
    try {
      const res = await csrfFetch("/api/agents/accept-terms", { method: "POST", credentials: "include" });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        queryClient.setQueryData([api.auth.me.path], (prev: any) =>
          prev ? { ...prev, termsAcceptedAt: data.termsAcceptedAt ?? new Date().toISOString() } : prev
        );
        setLocation("/dashboard");
      }
    } catch {
      // accept-terms failures leave the user on the modal; no client-side feedback needed
    }
    setTermsAccepting(false);
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotIdentifier.trim()) return;
    setForgotStatus("sending");
    setForgotError("");
    try {
      const res = await csrfFetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: forgotIdentifier.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setForgotStatus("error");
        setForgotError(body.message || "Something went wrong. Please try again.");
        return;
      }
      setForgotStatus("sent");
    } catch {
      setForgotStatus("error");
      setForgotError("Network error. Please try again.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setIsPending(true);
    setError(null);
    try {
      const result = await signIn('credentials', {
        email: identifier.trim(),
        password,
        redirect: false,
      });
      if (result?.error) {
        // next-auth carries the real reason in result.code (set by the
        // CredentialsSignin subclasses in auth.ts). Map the known codes to
        // their message; anything else is treated as bad credentials.
        if (result.code === "trial_expired") setError(t("loginErrorTrialExpired"));
        else if (result.code === "account_deactivated") setError(t("loginErrorDeactivated"));
        else setError(t("loginErrorCredentials"));
        return;
      }
      // signIn() sets the next-auth cookie, but the cached /api/me probe
      // still holds { authenticated: false } from page load (staleTime 5m,
      // no refetch on focus). Without forcing a fresh read here, the
      // dashboard guard sees the stale unauthenticated cache and bounces
      // straight back to /login — which is why login only "worked" after a
      // manual refresh. refetchQueries (default type: 'all') refetches the
      // inactive query and we await it so the cache is authenticated before
      // we navigate.
      await queryClient.refetchQueries({ queryKey: [api.auth.me.path] });
      setLocation('/dashboard');
    } catch {
      setError(t("loginErrorCredentials"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-white/[0.03] p-4 relative overflow-hidden font-sans antialiased" dir={isRtl ? "rtl" : "ltr"}>
      {/* Terms modal */}
      {showTermsModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-brand-navy rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]" dir={isRtl ? "rtl" : "ltr"}>
            <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
              <h2 className="text-lg font-bold text-white">{t("termsModalTitle")}</h2>
              <p className="text-sm text-brand-slate mt-1">{t("termsModalSubtitle")}</p>
            </div>
            <div className="flex-1 overflow-y-auto mx-4 my-4 border border-white/[0.08] rounded-xl bg-[#F5F2EC] px-5 py-4 text-center min-h-0">
              <p className="text-sm text-brand-slate mb-3">{t("termsModalSubtitle")}</p>
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-blue underline underline-offset-2 hover:text-brand-cyan transition-colors">
                {t("termsModalReadLink")}
              </a>
            </div>
            <div className="px-6 pb-6 pt-2 space-y-4">
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input type="checkbox" checked={termsChecked} onChange={e => setTermsChecked(e.target.checked)} className="mt-0.5 w-4 h-4 accent-brand-blue shrink-0" />
                <span className="text-sm text-white/90 leading-snug">{t("termsModalCheckbox")}</span>
              </label>
              <button
                disabled={!termsChecked || termsAccepting}
                onClick={handleAcceptTerms}
                className="w-full bg-brand-blue text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-brand-cyan transition-colors flex items-center justify-center gap-2"
              >
                {termsAccepting ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("termsModalAccepting")}</>
                ) : t("termsModalContinue")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forgot password modal */}
      {showForgotModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-brand-navy rounded-2xl shadow-2xl w-full max-w-md" dir={isRtl ? "rtl" : "ltr"}>
            <div className="px-6 pt-6 pb-4 border-b border-white/[0.06] flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Reset your password</h2>
                <p className="text-sm text-brand-slate mt-1">Enter your email and we'll send you a reset link.</p>
              </div>
              <button onClick={() => setShowForgotModal(false)} className="text-brand-slate/70 hover:text-brand-slate text-2xl leading-none">&times;</button>
            </div>
            <div className="px-6 py-5">
              {forgotStatus === "sent" ? (
                <div className="text-center py-4">
                  <p className="text-sm text-white/90">If an account exists for that email or phone, a reset link has been sent. The link is valid for 30 minutes.</p>
                  <button
                    onClick={() => setShowForgotModal(false)}
                    className="mt-5 w-full bg-brand-blue text-white py-3 rounded-xl font-semibold text-sm hover:bg-brand-cyan transition-colors"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotSubmit} className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-white/90 flex items-center gap-2 mb-1.5">
                      <Mail className="w-3.5 h-3.5 text-brand-slate/70" />
                      Email or phone
                    </label>
                    <input
                      type="text"
                      value={forgotIdentifier}
                      onChange={e => setForgotIdentifier(e.target.value)}
                      placeholder="email@example.com or +966501234567"
                      autoFocus
                      className="w-full px-4 py-2.5 border border-white/[0.08] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue/40 bg-brand-navy"
                    />
                  </div>
                  {forgotError && <p className="text-sm text-red-400">{forgotError}</p>}
                  <button
                    type="submit"
                    disabled={!forgotIdentifier.trim() || forgotStatus === "sending"}
                    className="w-full bg-brand-blue text-white py-3 rounded-xl font-semibold text-sm disabled:opacity-50 hover:bg-brand-cyan transition-colors flex items-center justify-center gap-2"
                  >
                    {forgotStatus === "sending" && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    Send reset link
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Back to home */}
      <div className={`absolute top-4 ${isRtl ? "right-4" : "left-4"} z-10`}>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-slate hover:text-brand-blue transition-colors"
        >
          <ArrowLeft className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`} />
          Home
        </a>
      </div>

      {/* Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -end-40 w-96 h-96 bg-brand-blue/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -start-40 w-96 h-96 bg-brand-cyan/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Logo size="lg" priority className="mb-4" />
          <h1 className="text-xl font-bold text-white tracking-tight">WAK Solutions</h1>
          <p className="text-sm text-brand-slate mt-1">{t("loginTagline")}</p>
        </div>

        {/* Card */}
        <div className="bg-brand-navy rounded-2xl border border-white/[0.08] shadow-sm p-8">
          <div className="flex flex-col items-center text-center mb-7">
            <h2 className="text-lg font-semibold text-white">{t("loginTitle")}</h2>
            <p className="text-sm text-brand-slate mt-1">{t("loginSubtitle")}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/90 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-brand-slate/70" />
                Email or Mobile Number
              </label>
              <input
                type="text"
                placeholder="email@example.com or +966501234567"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                disabled={isPending}
                autoComplete="username"
                className="w-full px-4 py-2.5 border border-white/[0.08] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue/40 disabled:opacity-50 bg-brand-navy"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-white/90 flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-brand-slate/70" />
                {t("loginPassword")}
              </label>
              <input
                data-testid="input-password"
                type="password"
                placeholder={t("loginPasswordPlaceholder")}
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={isPending}
                autoFocus={!identifier}
                className="w-full px-4 py-2.5 border border-white/[0.08] rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20 focus:border-brand-blue/40 disabled:opacity-50 bg-brand-navy"
              />
              {error && (
                <p data-testid="text-error" className="text-sm text-red-400 pt-1">
                  {error || t("loginErrorCredentials")}
                </p>
              )}
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowForgotModal(true);
                    setForgotIdentifier(identifier);
                    setForgotStatus("idle");
                    setForgotError("");
                  }}
                  className="text-xs font-medium text-brand-blue hover:text-brand-cyan transition-colors"
                >
                  Forgot password?
                </button>
              </div>
            </div>
            <button
              data-testid="button-login"
              type="submit"
              disabled={!password || isPending}
              className="w-full bg-brand-blue text-white py-3 rounded-xl font-semibold text-sm hover:bg-brand-cyan transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isPending && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
              {t("loginSignIn")}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-brand-slate mt-5">
          Don't have an account?{" "}
          <a href="/register" className="font-medium text-brand-blue hover:text-brand-cyan transition-colors">
            Start free trial
          </a>
        </p>

        <p className="text-center text-xs text-brand-slate/70 mt-4">
          {t("loginCopyright")} &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
