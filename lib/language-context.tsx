"use client";

/**
 * Language context (en / ar) + RTL toggle. Port of
 * client/src/lib/language-context.tsx. Marked "use client" because it
 * uses React.createContext + useState + localStorage.
 *
 * The old client/src/lib/language-context.tsx remains for any old-tree
 * consumers that still import from `@/lib/language-context` — both
 * resolve to the same component via the dual `@/*` alias mapping; the
 * new path (lib/language-context.tsx) wins.
 */

import { createContext, useContext, useState, useEffect } from 'react';
import { en, ar, type TranslationKey } from '@/locales/translations';

type Lang = 'en' | 'ar';

interface LanguageContextValue {
  lang: Lang;
  toggleLang: () => void;
  isRTL: boolean;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  toggleLang: () => {},
  isRTL: false,
  t: (key) => en[key],
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'en';
    return ((localStorage.getItem('lang') as Lang) ?? 'en');
  });

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    localStorage.setItem('lang', lang);
  }, [lang]);

  const toggleLang = () => setLang((l) => (l === 'en' ? 'ar' : 'en'));
  const t = (key: TranslationKey): string => (lang === 'ar' ? ar : en)[key];

  return (
    <LanguageContext.Provider value={{ lang, toggleLang, isRTL: lang === 'ar', t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
