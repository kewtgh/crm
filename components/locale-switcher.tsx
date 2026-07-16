"use client";

import { Languages } from "lucide-react";
import { useI18n } from "./i18n-provider";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const next = locale === "zh-CN" ? "en" : "zh-CN";
  return <button className={compact ? "locale-switcher compact" : "locale-switcher"} type="button" onClick={() => setLocale(next)} aria-label={t("locale.switch")}><Languages size={16} /><span>{locale === "zh-CN" ? "EN" : "中文"}</span></button>;
}
