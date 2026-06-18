import { useState, useEffect } from "react";
import { useLocation, Link } from "@/lib/router";
import {
  Inbox, Users, BookUser, ContactRound, BarChart3, Video, Bot,
  ClipboardList, BookOpen, LogOut, Globe, Menu, X,
  Bell, Share, Headphones, Settings, CalendarCheck, Infinity, CreditCard,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth, useLogout } from "@/hooks/use-auth";
import { useLanguage } from "@/lib/language-context";
import { usePushNotifications } from "@/hooks/use-push";
import { csrfFetch } from "@/lib/queryClient";
import { Logo } from "@/components/ui/Logo";

interface TrialStatus {
  trialDays: number;
  createdAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  daysRemaining: number;
  unlimited: boolean;
}

interface NavItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  adminOnly?: boolean;
  platformOnly?: boolean;
}

/**
 * Shared dashboard layout — dark green sidebar + white content area.
 * Wraps every authenticated dashboard page.
 *
 * Props:
 *  - children: page content
 *  - noPadding: skip the default p-8 on the content area (for full-bleed pages like inbox/chat)
 */
export default function DashboardLayout({
  children,
  noPadding = false,
}: {
  children: React.ReactNode;
  noPadding?: boolean;
}) {
  const [location, setLocation] = useLocation();
  const { isAuthenticated, isLoading: isAuthLoading, isAdmin, agentName, companyId } = useAuth();
  // Platform owner = WAK Solutions (company 1). Only its admins manage other
  // tenants' subscriptions. Mirrors withPlatformAdmin on the server.
  const isPlatformOwner = isAdmin && companyId === 1;
  const { mutate: logout } = useLogout();
  const { lang, toggleLang, t } = useLanguage();
  const isRtl = lang === "ar";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const { showBanner, showInstallPrompt, enableNotifications, dismissInstallPrompt } = usePushNotifications(isAuthenticated, isAuthLoading);

  // Trial badge — only fetch once authenticated. Server returns the canonical
  // daysRemaining (computed from companies.created_at + config.trial_days).
  const { data: trial } = useQuery<TrialStatus>({
    queryKey: ['/api/me/trial'],
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const trialDays = trial?.trialDays ?? 0;
  const daysRemaining = trial?.daysRemaining ?? 0;
  const showUnlimited = trial?.unlimited || !trial || trialDays <= 0;

  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isAuthLoading && !isAuthenticated) {
      setLocation("/login");
    }
  }, [isAuthLoading, isAuthenticated, setLocation]);

  if (isAuthLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-navy">
        <div className="w-8 h-8 border-4 border-brand-blue/20 border-t-brand-blue rounded-full animate-spin" />
      </div>
    );
  }

  const handleLogout = () => {
    logout(undefined, { onSuccess: () => setLocation("/login") });
  };

  const navItems: NavItem[] = [
    { href: "/dashboard",     icon: <Inbox className="w-[18px] h-[18px]" />,        label: t("inbox") },
    { href: "/inbox",         icon: <Headphones className="w-[18px] h-[18px]" />,  label: t("inboxTitle") ?? "Escalations" },
    { href: "/agents",        icon: <Users className="w-[18px] h-[18px]" />,        label: t("agents"),    adminOnly: true },
    { href: "/contacts",      icon: <BookUser className="w-[18px] h-[18px]" />,     label: t("contacts"),  adminOnly: true },
    { href: "/customers",     icon: <ContactRound className="w-[18px] h-[18px]" />, label: t("customers"), adminOnly: true },
    { href: "/statistics",    icon: <BarChart3 className="w-[18px] h-[18px]" />,    label: t("statistics") },
    { href: "/meetings",      icon: <Video className="w-[18px] h-[18px]" />,        label: t("meetings") },
    { href: "/chatbot-config",icon: <Bot className="w-[18px] h-[18px]" />,          label: t("chatbotConfig") },
    { href: "/surveys",       icon: <ClipboardList className="w-[18px] h-[18px]" />,label: t("surveys") },
    { href: "/guide",         icon: <BookOpen className="w-[18px] h-[18px]" />,     label: t("guide") },
    { href: "/settings",      icon: <Settings className="w-[18px] h-[18px]" />,     label: t("settings"), adminOnly: true },
    { href: "/admin/subscriptions", icon: <CreditCard className="w-[18px] h-[18px]" />, label: t("subscriptions"), platformOnly: true },
  ];

  const visibleNav = navItems.filter(n => (!n.adminOnly || isAdmin) && (!n.platformOnly || isPlatformOwner));

  /* Split nav into main items and admin-only items for section divider */
  const mainNav = visibleNav.filter(n => !n.adminOnly && !n.platformOnly);
  const adminNav = visibleNav.filter(n => n.adminOnly || n.platformOnly);

  const isActive = (href: string) => {
    if (href === "/dashboard") return location === "/dashboard" || location === "/";
    return location === href;
  };

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="flex h-[100dvh] overflow-hidden bg-background font-sans text-foreground antialiased">

      {/* ─── Desktop Sidebar ─── */}
      <aside className="hidden md:flex flex-col w-[232px] bg-brand-ink shrink-0 border-r border-white/[0.06]">
        {/* Logo */}
        <div className="px-4 py-5 flex items-center justify-between border-b border-white/[0.06]">
          <Link href="/dashboard" className="flex items-center gap-2.5 cursor-pointer">
            <Logo size="sm" priority className="shrink-0" />
            <span className="text-white/90 font-semibold text-sm tracking-tight">WAK Solutions</span>
          </Link>
          <span
            className={`w-2.5 h-2.5 rounded-full animate-pulse shrink-0 ${isOnline ? "bg-brand-emerald" : "bg-brand-amber"}`}
            title={isOnline ? "Online" : "Reconnecting..."}
          />
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 px-2.5 overflow-y-auto">
          {/* Main nav items (visible to all) */}
          <div className="space-y-0.5">
            {mainNav.map(n => (
              <Link key={n.href} href={n.href} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
                isActive(n.href)
                  ? "border-s-[3px] border-white bg-brand-navy/15 text-white shadow-sm"
                  : "text-white/55 hover:text-white/85 hover:bg-brand-navy/[0.08]"
              }`}>
                {n.icon}
                {n.label}
              </Link>
            ))}
          </div>

          {/* Section divider between main and admin items */}
          {adminNav.length > 0 && (
            <>
              <div className="my-2.5 border-b border-white/[0.08]" />
              <div className="space-y-0.5">
                {adminNav.map(n => (
                  <Link key={n.href} href={n.href} className={`flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium transition-colors ${
                    isActive(n.href)
                      ? "border-s-[3px] border-white bg-brand-navy/15 text-white shadow-sm"
                      : "text-white/55 hover:text-white/85 hover:bg-brand-navy/[0.08]"
                  }`}>
                    {n.icon}
                    {n.label}
                  </Link>
                ))}
              </div>
            </>
          )}
        </nav>

        {/* Agent name */}
        {agentName && (
          <div className="px-5 py-3 border-t border-white/10 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-brand-navy/20 flex items-center justify-center shrink-0">
              <span className="text-white text-[11px] font-bold leading-none">
                {agentName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
              </span>
            </div>
            <span className="text-white/80 text-[13px] font-medium truncate">{agentName}</span>
          </div>
        )}

        {/* Bottom actions */}
        <div className="px-3.5 pb-5 pt-3 border-t border-white/10 space-y-0.5">
          <button
            onClick={toggleLang}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium text-white/55 hover:text-white/85 hover:bg-brand-navy/[0.08] transition-colors"
          >
            <Globe className="w-[18px] h-[18px]" /> {t("switchLang")}
          </button>
          <button
            onClick={handleLogout}
            data-testid="button-logout"
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[13.5px] font-medium text-white/55 hover:text-red-300 hover:bg-brand-navy/[0.08] transition-colors"
          >
            <LogOut className="w-[18px] h-[18px]" /> {t("logout")}
          </button>
        </div>
      </aside>

      {/* ─── Mobile header + menu ─── */}
      <div className="md:hidden fixed top-0 inset-x-0 z-50 bg-brand-ink h-[56px] flex items-center justify-between px-4 border-b border-white/[0.06]">
        <Link href="/dashboard" className="flex items-center gap-2.5 cursor-pointer">
          <Logo size={22} className="shrink-0" />
          <span className="text-white/90 font-semibold text-sm">WAK Solutions</span>
          <span
            className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${isOnline ? "bg-brand-emerald" : "bg-brand-amber"}`}
            title={isOnline ? "Online" : "Reconnecting..."}
          />
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/book-demo" className="inline-flex items-center gap-1 text-white/80 border border-white/30 hover:border-white/60 text-[10px] font-semibold px-2 py-1 rounded-md transition-colors">
            <CalendarCheck className="w-3 h-3" /> Demo
          </Link>
          <span className="inline-flex items-center gap-1 bg-amber-400/20 text-amber-200 text-[10px] font-semibold px-2 py-1 rounded-full border border-amber-300/30">
            {showUnlimited ? (
              <><Infinity className="w-2.5 h-2.5" /> ∞</>
            ) : (
              <>{daysRemaining}d</>
            )}
          </span>
          {agentName && (
            <div className="w-7 h-7 rounded-full bg-brand-navy/20 flex items-center justify-center">
              <span className="text-white text-[11px] font-bold leading-none">
                {agentName.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase()}
              </span>
            </div>
          )}
          <button onClick={toggleLang} className="text-white/55 hover:text-white p-1.5 rounded transition-colors">
            <Globe className="w-4 h-4" />
          </button>
          <button onClick={() => setMobileOpen(true)} className="text-white/80 hover:text-white p-1.5 rounded transition-colors">
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] md:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className={`absolute top-0 ${isRtl ? "left-0" : "right-0"} h-full w-80 bg-brand-navy shadow-xl flex flex-col`} onClick={e => e.stopPropagation()}>
            <div className="h-[56px] bg-brand-ink flex items-center justify-between px-5">
              <span className="text-white font-semibold text-sm">{t("menu")}</span>
              <button onClick={() => setMobileOpen(false)} className="text-white/70 hover:text-white p-1 rounded transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto py-2">
              {visibleNav.map(item => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-4 px-5 py-3.5 text-sm font-medium transition-colors min-h-[48px] ${
                    isActive(item.href)
                      ? "bg-brand-blue/10 text-brand-blue border-s-4 border-brand-cyan"
                      : "text-white/90 hover:bg-white/[0.03]"
                  }`}
                >
                  <span className={isActive(item.href) ? "text-brand-blue" : "text-brand-slate/70"}>{item.icon}</span>
                  {item.label}
                </Link>
              ))}
              <button
                onClick={() => { toggleLang(); setMobileOpen(false); }}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-sm font-medium text-white/90 hover:bg-white/[0.03] transition-colors min-h-[48px]"
              >
                <span className="text-brand-slate/70"><Globe className="w-5 h-5" /></span>
                {t("switchLang")}
              </button>
              <button
                onClick={() => { handleLogout(); setMobileOpen(false); }}
                className="w-full flex items-center gap-4 px-5 py-3.5 text-sm font-medium text-red-400 hover:bg-red-500/10 transition-colors min-h-[48px]"
              >
                <span className="text-red-400"><LogOut className="w-5 h-5" /></span>
                {t("logout")}
              </button>
            </nav>
          </div>
        </div>
      )}

      {/* ─── Main content ─── */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
        {/* Desktop top bar */}
        <div className="hidden md:flex items-center justify-end gap-3 px-6 py-2.5 border-b border-white/[0.06] bg-brand-navy shrink-0">
          <span className="inline-flex items-center gap-1.5 bg-brand-amber/15 text-brand-amber border border-brand-amber/30 text-[11px] font-semibold px-2.5 py-1 rounded-full">
            {showUnlimited ? (
              <><Infinity className="w-3 h-3" /> Unlimited days remaining</>
            ) : (
              <>{daysRemaining} days remaining</>
            )}
          </span>
          <Link href="/book-demo" className="inline-flex items-center gap-1.5 text-brand-blue border border-brand-blue/40 hover:border-brand-blue hover:bg-brand-blue/5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
            <CalendarCheck className="w-3.5 h-3.5" /> Book a Demo
          </Link>
        </div>

        {/* Banners — wrapped so portrait-mobile CSS can push them below the fixed navbar */}
        {(showInstallPrompt || showBanner) && (
          <div className="notification-banners">
            {showInstallPrompt && (
              <div className="bg-brand-blue/10 border-b border-brand-cyan/30 px-5 py-2.5 flex items-center justify-between gap-3 shrink-0 md:flex">
                <div className="flex items-center gap-2 text-sm text-blue-800">
                  <Share className="w-4 h-4 shrink-0" />
                  <span>{t("iosInstallPrompt")}</span>
                </div>
                <button onClick={dismissInstallPrompt} className="shrink-0 text-brand-cyan hover:text-blue-800 p-1 rounded transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {showBanner && (
              <div className="bg-brand-amber/15 border-b border-brand-amber/30 px-5 py-2.5 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2 text-sm text-amber-800">
                  <Bell className="w-4 h-4 shrink-0" />
                  <span>{t("enableNotificationsPrompt")}</span>
                </div>
                <button onClick={enableNotifications} className="shrink-0 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg transition-colors">
                  {t("enableNotifications")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Page content */}
        <main className={`flex-1 min-h-0 ${noPadding ? "overflow-hidden" : "overflow-y-auto md:overflow-hidden"} pt-14 md:pt-0 ${noPadding ? "" : "p-8"}`}>
          {children}
        </main>
      </div>
    </div>
  );
}
