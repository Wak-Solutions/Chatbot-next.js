"use client";

export const dynamic = 'force-dynamic';

import { useState, useEffect, useRef } from "react";
import { Link } from "@/lib/router";
import { useLanguage } from "@/lib/language-context";
import ProductDemo from "./ProductDemo";
import {
  Bot, Users, Calendar, Mic, BarChart3, TrendingUp,
  Link2, Settings, Rocket, Zap, Clock, Globe, MessageCircle,
  ChevronDown, Check, Menu, X, ArrowRight, Play,
} from "lucide-react";
import { Logo } from "@/components/ui/Logo";

/* ─── Bilingual copy ──────────────────────────────────────────── */
const copy = {
  en: {
    /* nav */
    features: "Features",
    howItWorks: "How it works",
    pricing: "Pricing",
    faq: "FAQ",
    login: "Login",
    startTrial: "Free Trial / Sign Up",
    seeDemo: "See it in action",
    /* hero */
    heroTitle: "AI-powered WhatsApp for businesses that can't afford to miss a message.",
    heroSub: "WAK connects your WhatsApp to an AI that replies instantly, books meetings, escalates to agents, and works 24/7 — in Arabic and English.",
    heroProof: "Trusted by businesses across Saudi Arabia · Replies in under 3 seconds · Available 24/7",
    /* logos */
    logosTitle: "Trusted by businesses in",
    logosSaudi: "Saudi Arabia",
    /* how it works */
    howTitle: "How it works",
    howSub: "Get started in three simple steps",
    step1: "Connect your WhatsApp",
    step1d: "Plug in your business number in minutes. No special hardware required.",
    step2: "Configure your chatbot",
    step2d: "Set your FAQs, tone, escalation rules, and working hours.",
    step3: "Go live",
    step3d: "Your AI starts handling conversations immediately. Monitor everything from the dashboard.",
    /* features */
    featTitle: "Everything you need to automate customer conversations",
    featSub: "Powerful features that work together seamlessly",
    f1: "AI Conversations",
    f1d: "Replies instantly in Arabic & English with natural, context-aware responses.",
    f2: "Smart Escalation",
    f2d: "Routes complex queries to human agents with full conversation history.",
    f3: "Meeting Booking",
    f3d: "Customers book appointments directly via WhatsApp — no links or apps needed.",
    f4: "Voice Notes",
    f4d: "Transcribes and understands voice messages so nothing gets lost.",
    f5: "Analytics Dashboard",
    f5d: "Track every conversation, response time, and agent performance in real time.",
    f6: "Customer Journey",
    f6d: "Visualize every touchpoint from first message to resolution.",
    /* stats */
    stat1: "< 3 seconds",
    stat1d: "Average response time",
    stat2: "24/7",
    stat2d: "Availability",
    stat3: "Arabic & English",
    stat3d: "Full language support",
    stat4: "100%",
    stat4d: "WhatsApp native",
    /* pricing */
    priceTitle: "Simple, transparent pricing",
    priceSub: "Choose the plan that fits your business",
    starter: "Starter",
    starterPrice: "50",
    growth: "Growth",
    growthPrice: "150",
    enterprise: "Pro",
    enterprisePrice: "300",
    mo: "/month",
    sar: "SAR",
    popular: "Most popular",
    priceCta: "Get started",
    priceCtaEnterprise: "Get started",
    priceNote: "All plans include {days}-day free trial. No credit card required.",
    ps1: ["300 chats / month", "3,000 messages / month", "AI chatbot (Arabic & English)", "Meeting booking", "Basic analytics", "Email support"],
    ps2: ["1,200 chats / month", "12,000 messages / month", "Everything in Starter", "Voice note transcription", "Smart escalation", "Priority support"],
    ps3: ["3,000 chats / month", "30,000 messages / month", "Everything in Growth", "Custom integrations", "Priority support", "Dedicated onboarding"],
    /* faq */
    faqTitle: "Frequently asked questions",
    faqSub: "Everything you need to know",
    q1: "Do I need a Meta Business account?",
    a1: "Yes. WhatsApp Business API requires a verified Meta Business account. We'll guide you through the setup process — it usually takes less than 24 hours.",
    q2: "Does it work with my existing WhatsApp number?",
    a2: "Yes! You can use your current business number. We'll help you migrate it to the WhatsApp Business API without losing your existing chats.",
    q3: "Is my customers' data secure?",
    a3: "Absolutely. All data is encrypted in transit and at rest. We use enterprise-grade PostgreSQL databases and follow industry best practices for data protection.",
    q4: "Can I switch plans later?",
    a4: "Yes, you can upgrade or downgrade at any time. Changes take effect immediately, and billing is prorated.",
    q5: "Does it support Arabic?",
    a5: "Fully. The AI chatbot understands and responds in both Arabic (including Saudi dialect) and English. The dashboard is also fully bilingual.",
    /* cta */
    ctaTitle: "Ready to stop missing messages?",
    ctaSub: "Join businesses across Saudi Arabia that are already using WAK to delight their customers.",
    /* footer */
    terms: "Terms & Conditions",
    privacy: "Privacy Policy",
    copy: "WAK Solutions",
    rights: "All rights reserved.",
    switchLang: "العربية",
    /* chat mockup */
    chatName: "WAK Solutions",
    chatOnline: "online",
    chatMsg1: "Hi, I want to book an appointment",
    chatMsg2: "Hello! 👋 I can help you with that. When would you like to schedule?",
    chatMsg3: "Sunday at 10 AM",
    chatMsg4: "Done! ✅ Your appointment is booked for Sunday, 10:00 AM. You'll receive a confirmation shortly.",
    chatPlaceholder: "Type a message",
  },
  ar: {
    features: "المميزات",
    howItWorks: "طريقة العمل",
    pricing: "الأسعار",
    faq: "الأسئلة الشائعة",
    login: "تسجيل الدخول",
    startTrial: "تجربة مجانية / تسجيل",
    seeDemo: "شاهده بنفسك",
    heroTitle: "واتساب بالذكاء الاصطناعي للشركات اللي ما تقدر تفوّت أي رسالة.",
    heroSub: "واك يربط واتساب شركتك بذكاء اصطناعي يرد فوراً، يحجز مواعيد، يحوّل للموظفين، ويشتغل ٢٤/٧ — بالعربي والإنجليزي.",
    heroProof: "موثوق من شركات في السعودية · الرد خلال ٣ ثواني · متوفر ٢٤/٧",
    logosTitle: "موثوق من شركات في",
    logosSaudi: "المملكة العربية السعودية",
    howTitle: "طريقة العمل",
    howSub: "ابدأ في ثلاث خطوات بسيطة",
    step1: "اربط واتسابك",
    step1d: "أدخل رقم شركتك في دقائق. بدون أجهزة خاصة.",
    step2: "اضبط البوت",
    step2d: "حدد الأسئلة الشائعة، نبرة الرد، قواعد التحويل، وأوقات العمل.",
    step3: "انطلق",
    step3d: "الذكاء الاصطناعي يبدأ يرد على المحادثات فوراً. تابع كل شي من لوحة التحكم.",
    featTitle: "كل اللي تحتاجه لأتمتة محادثات العملاء",
    featSub: "مميزات قوية تشتغل مع بعض بسلاسة",
    f1: "محادثات ذكية",
    f1d: "يرد فوراً بالعربي والإنجليزي بردود طبيعية تفهم السياق.",
    f2: "تحويل ذكي",
    f2d: "يحوّل الاستفسارات المعقدة لموظف بشري مع كامل سجل المحادثة.",
    f3: "حجز مواعيد",
    f3d: "العميل يحجز مباشرة من واتساب — بدون روابط أو تطبيقات.",
    f4: "رسائل صوتية",
    f4d: "يفرّغ ويفهم الرسائل الصوتية عشان ما يضيع شي.",
    f5: "لوحة تحليلات",
    f5d: "تابع كل محادثة، وقت الرد، وأداء الموظفين لحظة بلحظة.",
    f6: "رحلة العميل",
    f6d: "شوف كل نقطة تواصل من أول رسالة لين الحل.",
    stat1: "< ٣ ثواني",
    stat1d: "متوسط وقت الرد",
    stat2: "٢٤/٧",
    stat2d: "متوفر دائماً",
    stat3: "عربي وإنجليزي",
    stat3d: "دعم كامل للغتين",
    stat4: "١٠٠٪",
    stat4d: "واتساب أصلي",
    priceTitle: "أسعار واضحة وبسيطة",
    priceSub: "اختر الباقة المناسبة لشركتك",
    starter: "المبتدئ",
    starterPrice: "٥٠",
    growth: "النمو",
    growthPrice: "١٥٠",
    enterprise: "المحترف",
    enterprisePrice: "٣٠٠",
    mo: "/شهرياً",
    sar: "ر.س",
    popular: "الأكثر شعبية",
    priceCta: "ابدأ الآن",
    priceCtaEnterprise: "ابدأ الآن",
    priceNote: "جميع الباقات تشمل تجربة مجانية {days} يوم. بدون بطاقة ائتمان.",
    ps1: ["٣٠٠ محادثة/شهرياً", "٣,٠٠٠ رسالة/شهرياً", "بوت ذكي (عربي وإنجليزي)", "حجز مواعيد", "تحليلات أساسية", "دعم بالإيميل"],
    ps2: ["١,٢٠٠ محادثة/شهرياً", "١٢,٠٠٠ رسالة/شهرياً", "كل مميزات المبتدئ", "تفريغ رسائل صوتية", "تحويل ذكي", "دعم أولوية"],
    ps3: ["٣,٠٠٠ محادثة/شهرياً", "٣٠,٠٠٠ رسالة/شهرياً", "كل مميزات النمو", "تكاملات مخصصة", "دعم أولوية", "تهيئة مخصصة"],
    faqTitle: "الأسئلة الشائعة",
    faqSub: "كل اللي تحتاج تعرفه",
    q1: "هل أحتاج حساب ميتا للأعمال؟",
    a1: "نعم. واجهة واتساب للأعمال تتطلب حساب ميتا موثّق. بنساعدك في الإعداد — عادة يأخذ أقل من ٢٤ ساعة.",
    q2: "هل يشتغل مع رقم واتسابي الحالي؟",
    a2: "أكيد! تقدر تستخدم رقمك الحالي. بنساعدك تنقله لواجهة واتساب للأعمال بدون ما تخسر محادثاتك.",
    q3: "هل بيانات عملائي آمنة؟",
    a3: "طبعاً. كل البيانات مشفرة أثناء النقل والتخزين. نستخدم قواعد بيانات PostgreSQL بمعايير المؤسسات ونتبع أفضل الممارسات لحماية البيانات.",
    q4: "أقدر أغير الباقة بعدين؟",
    a4: "نعم، تقدر تترقى أو تنزل بأي وقت. التغييرات تطبق فوراً والفاتورة تتعدل تلقائياً.",
    q5: "هل يدعم العربي؟",
    a5: "بالكامل. البوت يفهم ويرد بالعربي (بما فيها اللهجة السعودية) والإنجليزي. لوحة التحكم كمان ثنائية اللغة.",
    ctaTitle: "مستعد توقف تفويت الرسائل؟",
    ctaSub: "انضم للشركات السعودية اللي تستخدم واك لإسعاد عملائها.",
    terms: "الشروط والأحكام",
    privacy: "سياسة الخصوصية",
    copy: "واك سولوشنز",
    rights: "جميع الحقوق محفوظة.",
    switchLang: "English",
    chatName: "واك سولوشنز",
    chatOnline: "متصل",
    chatMsg1: "مرحبا، أبي أحجز موعد",
    chatMsg2: "أهلاً وسهلاً! 👋 أقدر أساعدك بالحجز. متى يناسبك؟",
    chatMsg3: "يوم الأحد الساعة ١٠ الصبح",
    chatMsg4: "تم! ✅ موعدك محجوز يوم الأحد الساعة ١٠:٠٠ صباحاً. راح يوصلك تأكيد قريب.",
    chatPlaceholder: "اكتب رسالة",
  },
} as const;

type Lang = keyof typeof copy;

/* ─── Scroll-reveal hook ──────────────────────────────────────── */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.01 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const { ref, visible } = useReveal();
  return (
    <div
      ref={ref}
      className={`transition-all duration-700 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ─── WhatsApp mockup ─────────────────────────────────────────── */
function WhatsAppMockup(_props: { t: (typeof copy)[Lang]; isRtl: boolean }) {
  return (
    <div className="mx-auto" style={{ width: "min(320px, 85vw)" }}>
      <img
        src="/iphone-mockup.png"
        alt="WAK Solutions WhatsApp conversation on iPhone"
        className="w-full h-auto"
      />
    </div>
  );
}

/* ─── FAQ accordion item ──────────────────────────────────────── */
function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/[0.06] last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-5 text-start gap-4 group"
      >
        <span className="text-base font-medium text-white group-hover:text-brand-cyan transition-colors">{question}</span>
        <ChevronDown className={`w-5 h-5 text-brand-slate shrink-0 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        className={`overflow-hidden transition-all duration-300 ${open ? "max-h-60 pb-5" : "max-h-0"}`}
      >
        <p className="text-sm text-brand-slate leading-relaxed">{answer}</p>
      </div>
    </div>
  );
}

/* ─── Pricing card ────────────────────────────────────────────── */
function PricingCard({
  name, price, currency, period, features, cta, highlighted, badge, ctaHref,
}: {
  name: string; price: string; currency: string; period: string;
  features: string[]; cta: string; highlighted?: boolean; badge?: string; ctaHref?: string;
}) {
  return (
    <div className={`relative rounded-2xl p-8 flex flex-col transition-all ${
      highlighted
        ? "bg-gradient-primary text-white border border-transparent shadow-2xl shadow-brand-blue/40 scale-[1.02] lg:scale-105 z-10"
        : "bg-brand-navy text-white border border-white/[0.06] hover:shadow-glow-cyan"
    }`}>
      {badge && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-cyan text-brand-ink text-xs font-semibold px-4 py-1 rounded-full">
          {badge}
        </span>
      )}
      <h3 className="text-lg font-semibold">{name}</h3>
      <div className="mt-4 mb-6">
        {price === "Custom" || price === "حسب الطلب" ? (
          <span className="text-3xl font-bold">{price}</span>
        ) : (
          <>
            <span className={`text-sm ${highlighted ? "text-white/70" : "text-brand-slate"}`}>{currency} </span>
            <span className="text-4xl font-bold">{price}</span>
            <span className={`text-sm ${highlighted ? "text-white/70" : "text-brand-slate"}`}>{period}</span>
          </>
        )}
      </div>
      <ul className="space-y-3 flex-1">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm">
            <Check className={`w-4 h-4 shrink-0 mt-0.5 ${highlighted ? "text-white" : "text-brand-cyan"}`} />
            <span className={highlighted ? "text-white" : "text-white/90"}>{f}</span>
          </li>
        ))}
      </ul>
      {ctaHref ? (
        <a href={ctaHref} target="_blank" rel="noopener noreferrer" className={`mt-8 block text-center py-3 rounded-xl font-semibold text-sm transition-all ${
          highlighted
            ? "bg-white text-brand-blue hover:brightness-95"
            : "border border-brand-cyan text-brand-cyan hover:bg-brand-cyan/10"
        }`}>
          {cta}
        </a>
      ) : (
        <Link href="/register" className={`mt-8 block text-center py-3 rounded-xl font-semibold text-sm transition-all ${
          highlighted
            ? "bg-white text-brand-blue hover:brightness-95"
            : "border border-brand-cyan text-brand-cyan hover:bg-brand-cyan/10"
        }`}>
          {cta}
        </Link>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════ */
/*  LANDING PAGE                                                   */
/* ═══════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const { lang, toggleLang } = useLanguage();
  const t = copy[(lang as Lang)] ?? copy.en;
  const isRtl = lang === "ar";
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [trialDays, setTrialDays] = useState<number>(14);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    fetch("/api/config/trial-days")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.trialDays) setTrialDays(d.trialDays); })
      .catch(() => {});
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMobileOpen(false);
  };

  const navLinks = [
    { label: t.features, id: "features" },
    { label: t.howItWorks, id: "how-it-works" },
    { label: t.pricing, id: "pricing" },
    { label: t.faq, id: "faq" },
  ];

  const features = [
    { icon: Bot, title: t.f1, desc: t.f1d },
    { icon: Users, title: t.f2, desc: t.f2d },
    { icon: Calendar, title: t.f3, desc: t.f3d },
    { icon: Mic, title: t.f4, desc: t.f4d },
    { icon: BarChart3, title: t.f5, desc: t.f5d },
    { icon: TrendingUp, title: t.f6, desc: t.f6d },
  ];

  const steps = [
    { icon: Link2, num: "01", title: t.step1, desc: t.step1d },
    { icon: Settings, num: "02", title: t.step2, desc: t.step2d },
    { icon: Rocket, num: "03", title: t.step3, desc: t.step3d },
  ];

  const stats = [
    { icon: Zap, value: t.stat1, label: t.stat1d },
    { icon: Clock, value: t.stat2, label: t.stat2d },
    { icon: Globe, value: t.stat3, label: t.stat3d },
    { icon: MessageCircle, value: t.stat4, label: t.stat4d },
  ];

  const faqs = [
    { q: t.q1, a: t.a1 },
    { q: t.q2, a: t.a2 },
    { q: t.q3, a: t.a3 },
    { q: t.q4, a: t.a4 },
    { q: t.q5, a: t.a5 },
  ];

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen bg-brand-ink font-sans text-white antialiased overflow-x-hidden">

      {/* ─── NAV ──────────────────────────────────────────────── */}
      <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-brand-ink/85 backdrop-blur-xl border-b border-white/[0.06]" : "bg-transparent"
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 lg:h-20">
            {/* Logo */}
            <button onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} className="flex items-center gap-2.5">
              <Logo size="md" priority />
              <span className="font-bold text-lg text-white hidden sm:inline">WAK Solutions</span>
            </button>

            {/* Desktop links */}
            <div className="hidden lg:flex items-center gap-8">
              {navLinks.map(l => (
                <button key={l.id} onClick={() => scrollTo(l.id)} className="text-sm text-white/80 hover:text-brand-cyan transition-colors font-medium">
                  {l.label}
                </button>
              ))}
              <button onClick={toggleLang} className="flex items-center gap-1.5 text-sm font-medium text-white/80 hover:text-brand-cyan transition-colors">
                <Globe className="w-4 h-4 text-brand-cyan" />
                {t.switchLang}
              </button>
              <Link href="/login" className="text-sm font-medium text-brand-cyan border border-brand-cyan/60 px-4 py-2 rounded-lg hover:bg-brand-cyan/10 transition-colors">
                {t.login}
              </Link>
            </div>

            {/* Mobile: Login + hamburger */}
            <div className="lg:hidden flex items-center gap-2">
              <Link href="/login" className="text-sm font-medium text-brand-cyan border border-brand-cyan/60 px-3 py-1.5 rounded-lg hover:bg-brand-cyan/10 transition-colors">
                {t.login}
              </Link>
              <button onClick={() => setMobileOpen(!mobileOpen)} className="p-2 text-white/80">
                {mobileOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="lg:hidden bg-brand-ink border-t border-white/[0.06] shadow-lg">
            <div className="px-4 py-4 space-y-1">
              {navLinks.map(l => (
                <button key={l.id} onClick={() => scrollTo(l.id)} className="block w-full text-start px-4 py-3 text-sm text-white/80 hover:bg-white/[0.05] hover:text-brand-cyan rounded-lg font-medium">
                  {l.label}
                </button>
              ))}
              <div className="pt-3 border-t border-white/[0.06]">
                <button onClick={toggleLang} className="flex items-center gap-2 w-full px-4 py-3 text-sm text-white/80 hover:bg-white/[0.05] hover:text-brand-cyan rounded-lg font-medium">
                  <Globe className="w-4 h-4 text-brand-cyan" />
                  {t.switchLang}
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* ─── HERO ─────────────────────────────────────────────── */}
      <section className="relative pt-28 lg:pt-36 pb-16 lg:pb-24 overflow-hidden bg-brand-aurora">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-16">
            {/* Text */}
            <div className="flex-1 text-center lg:text-start max-w-2xl">
              <Reveal>
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight leading-[1.1] text-white">
                  <span className="text-gradient-primary">{isRtl ? "واتساب بالذكاء الاصطناعي" : "AI-powered WhatsApp"}</span>
                  {isRtl ? " " : " "}
                  <span className="text-white">
                    {t.heroTitle.replace(isRtl ? "واتساب بالذكاء الاصطناعي" : "AI-powered WhatsApp", "").trimStart()}
                  </span>
                </h1>
              </Reveal>
              <Reveal delay={100}>
                <p className="mt-6 text-lg text-white/70 leading-relaxed max-w-xl mx-auto lg:mx-0">
                  {t.heroSub}
                </p>
              </Reveal>
              <Reveal delay={200}>
                <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 justify-center lg:justify-start">
                  <Link href="/register" className="inline-flex items-center gap-2 bg-gradient-primary text-white font-semibold px-7 py-3.5 rounded-xl hover:brightness-110 transition-all shadow-glow-cyan text-sm">
                    {t.startTrial} <ArrowRight className="w-4 h-4 icon-directional" />
                  </Link>
                  <button onClick={() => setDemoOpen(true)} className="inline-flex items-center gap-2 text-brand-cyan font-semibold px-4 py-3.5 rounded-xl hover:bg-brand-cyan/10 transition-colors text-sm">
                    <Play className="w-4 h-4 text-brand-cyan" /> {t.seeDemo}
                  </button>
                </div>
              </Reveal>
              <Reveal delay={300}>
                <p className="mt-8 text-sm text-brand-slate">{t.heroProof}</p>
              </Reveal>
            </div>

            {/* Mockup */}
            <Reveal delay={200} className="flex-shrink-0">
              <WhatsAppMockup t={t} isRtl={isRtl} />
            </Reveal>
          </div>
        </div>
      </section>

      {/* ─── LOGOS BAR ────────────────────────────────────────── */}
      <section className="py-14 bg-brand-ink border-y border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <Reveal>
            <p className="text-sm font-medium text-brand-slate uppercase tracking-wider mb-8">
              {t.logosTitle} {t.logosSaudi}
            </p>
            <div className="flex items-center justify-center gap-6 sm:gap-10 flex-wrap">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="w-28 h-10 bg-white/[0.05] border border-white/[0.06] rounded-lg" />
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 lg:py-28 bg-brand-ink">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">{t.howTitle}</h2>
              <p className="mt-4 text-brand-slate text-lg">{t.howSub}</p>
            </div>
          </Reveal>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            {steps.map((s, i) => (
              <Reveal key={i} delay={i * 120}>
                <div className="relative text-center lg:text-start">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-blue/15 border border-brand-cyan/20 mb-5">
                    <s.icon className="w-6 h-6 text-brand-cyan" />
                  </div>
                  <span className="block text-xs font-bold text-brand-cyan tracking-widest uppercase mb-2">{s.num}</span>
                  <h3 className="text-xl font-semibold mb-2 text-white">{s.title}</h3>
                  <p className="text-brand-slate text-sm leading-relaxed">{s.desc}</p>
                  {i < 2 && (
                    <div className="hidden md:block absolute top-7 -end-6 lg:-end-6">
                      <ArrowRight className={`w-5 h-5 text-brand-slate/50 icon-directional`} />
                    </div>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─────────────────────────────────────────── */}
      <section id="features" className="py-20 lg:py-28 bg-brand-ink border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">{t.featTitle}</h2>
              <p className="mt-4 text-brand-slate text-lg">{t.featSub}</p>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {features.map((f, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className="bg-brand-navy rounded-2xl p-7 border border-white/[0.06] hover:shadow-glow-cyan transition-all h-full">
                  <div className="w-12 h-12 rounded-xl bg-brand-blue/15 border border-brand-cyan/20 flex items-center justify-center mb-4">
                    <f.icon className="w-5 h-5 text-brand-cyan" />
                  </div>
                  <h3 className="text-base font-semibold mb-2 text-white">{f.title}</h3>
                  <p className="text-sm text-brand-slate leading-relaxed">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── STATS ────────────────────────────────────────────── */}
      <section className="py-16 lg:py-20 bg-brand-navy border-y border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            {stats.map((s, i) => (
              <Reveal key={i} delay={i * 100}>
                <div className="text-center">
                  <s.icon className="w-7 h-7 text-brand-cyan mx-auto mb-3" />
                  <div className="text-2xl sm:text-3xl font-semibold text-white">{s.value}</div>
                  <div className="text-sm text-brand-slate mt-1">{s.label}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING ──────────────────────────────────────────── */}
      <section id="pricing" className="py-20 lg:py-28 bg-brand-ink">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">{t.priceTitle}</h2>
              <p className="mt-4 text-brand-slate text-lg">{t.priceSub}</p>
            </div>
          </Reveal>

          <div className="grid md:grid-cols-3 gap-6 lg:gap-8 max-w-5xl mx-auto items-start">
            <Reveal delay={0}>
              <PricingCard
                name={t.starter}
                price={t.starterPrice}
                currency={t.sar}
                period={t.mo}
                features={[...t.ps1]}
                cta={t.priceCta}
              />
            </Reveal>
            <Reveal delay={100}>
              <PricingCard
                name={t.growth}
                price={t.growthPrice}
                currency={t.sar}
                period={t.mo}
                features={[...t.ps2]}
                cta={t.priceCta}
                highlighted
                badge={t.popular}
              />
            </Reveal>
            <Reveal delay={200}>
              <PricingCard
                name={t.enterprise}
                price={t.enterprisePrice}
                currency={t.sar}
                period={t.mo}
                features={[...t.ps3]}
                cta={t.priceCtaEnterprise}
              />
            </Reveal>
          </div>

          <Reveal delay={300}>
            <p className="text-center text-sm text-brand-slate mt-10">{t.priceNote.replace("{days}", String(trialDays))}</p>
          </Reveal>
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────── */}
      <section id="faq" className="py-20 lg:py-28 bg-brand-ink border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <Reveal>
            <div className="text-center mb-12">
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white">{t.faqTitle}</h2>
              <p className="mt-4 text-brand-slate text-lg">{t.faqSub}</p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <div className="bg-brand-navy rounded-2xl border border-white/[0.06] px-6 sm:px-8">
              {faqs.map((f, i) => (
                <FAQItem key={i} question={f.q} answer={f.a} />
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── CTA BANNER ───────────────────────────────────────── */}
      <section className="py-20 lg:py-24 bg-gradient-primary relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 start-1/4 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 end-1/4 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
        </div>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative">
          <Reveal>
            <h2 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight">{t.ctaTitle}</h2>
            <p className="mt-4 text-white/80 text-lg">{t.ctaSub}</p>
            <div className="mt-8 flex items-center justify-center">
              <Link href="/register" className="inline-flex items-center gap-2 bg-white text-brand-blue font-semibold px-7 py-3.5 rounded-xl hover:brightness-95 transition-all text-sm shadow-lg">
                {t.startTrial} <ArrowRight className="w-4 h-4 icon-directional" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── FOOTER ───────────────────────────────────────────── */}
      <footer className="py-12 bg-brand-ink border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
            {/* Logo */}
            <div className="flex items-center gap-2.5">
              <Logo size="sm" />
              <span className="font-semibold text-white">{t.copy}</span>
            </div>

            {/* Links */}
            <div className="flex items-center gap-6 text-sm text-brand-slate">
              <Link href="/terms" className="hover:text-brand-cyan transition-colors">{t.terms}</Link>
              <Link href="/terms" className="hover:text-brand-cyan transition-colors">{t.privacy}</Link>
              <button onClick={toggleLang} className="flex items-center gap-1.5 hover:text-brand-cyan transition-colors">
                <Globe className="w-3.5 h-3.5" />
                {t.switchLang}
              </button>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-white/[0.06] text-center text-sm text-brand-slate/60">
            &copy; {new Date().getFullYear()} {t.copy}. {t.rights}
          </div>
        </div>
      </footer>

      {/* Interactive product demo overlay */}
      <ProductDemo open={demoOpen} onClose={() => setDemoOpen(false)} />

    </div>
  );
}
