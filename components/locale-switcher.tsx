"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { useI18n } from "./i18n-provider";

export function LocaleSwitcher({ compact = false, persist = false }: { compact?: boolean; persist?: boolean }) {
  const router = useRouter();
  const { locale, setLocale, t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const next = locale === "zh-CN" ? "en" : "zh-CN";
  const switchLocale = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (persist) {
        await apiFetch("/api/settings", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ section: "locale", locale: next }),
        });
      }
      await setLocale(next);
      router.refresh();
    } catch {
      setError(t("locale.persistFailed"));
    } finally {
      setBusy(false);
    }
  };
  return <span className="locale-switch-wrap"><button className={compact ? "locale-switcher compact" : "locale-switcher"} type="button" disabled={busy} onClick={() => void switchLocale()} aria-label={t("locale.switch")} aria-describedby={error ? "locale-switch-error" : undefined}><Languages size={16} /><span>{locale === "zh-CN" ? "EN" : "中文"}</span></button>{error && <span id="locale-switch-error" className="locale-switch-error" role="alert">{error}</span>}</span>;
}
