"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useI18n } from "./i18n-provider";

export function LocaleSwitcher({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const next = locale === "zh-CN" ? "en" : "zh-CN";
  return <button className={compact ? "locale-switcher compact" : "locale-switcher"} type="button" onClick={() => { setLocale(next); router.refresh(); }} aria-label={t("locale.switch")}><Languages size={16} /><span>{locale === "zh-CN" ? "EN" : "中文"}</span></button>;
}
