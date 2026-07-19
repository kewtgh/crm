"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Locale } from "@/lib/i18n";
import type { Messages } from "@/lib/i18n/types";

type I18nContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => Promise<void>;
  t: (key: string, values?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ initialLocale, initialMessages, children }: { initialLocale: Locale; initialMessages: Messages; children: React.ReactNode }) {
  const [locale, setLocaleState] = useState(initialLocale);
  const [messages,setMessages]=useState(initialMessages);
  const setLocale = useCallback(async(nextLocale: Locale) => {
    const nextMessages=nextLocale==="zh-CN"
      ?(await import("@/lib/i18n/locales/zh-CN")).zhCN
      :(await import("@/lib/i18n/locales/en")).en;
    setMessages(nextMessages);
    setLocaleState(nextLocale);
    document.cookie = `lumina-locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.lang = nextLocale;
    localStorage.setItem("lumina-locale", nextLocale);
  }, []);
  const value = useMemo(() => ({ locale, setLocale, t: (key: string, values?: Record<string, string | number>) => {
    const template=messages[key]??key;
    return values?Object.entries(values).reduce((message,[name,value])=>message.replaceAll(`{${name}}`,String(value)),template):template;
  } }), [locale, messages, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
