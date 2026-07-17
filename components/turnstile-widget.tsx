"use client";

import { useEffect, useId, useRef } from "react";
import { useI18n } from "./i18n-provider";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window { turnstile?: TurnstileApi; }
}

const SCRIPT_ID = "cloudflare-turnstile-script";

export function TurnstileWidget({ onToken, resetKey, error }: { onToken: (token: string) => void; resetKey: number; error?: string }) {
  const { locale, t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const errorId = `${useId().replace(/:/g, "")}-error`;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    let cancelled = false;
    const render = () => {
      if (cancelled || !siteKey || !containerRef.current || !window.turnstile || widgetRef.current) return;
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        language: locale === "zh-CN" ? "zh-CN" : "en",
        theme: "light",
        size: "flexible",
        action: "staff_login",
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.turnstile) render(); else existing.addEventListener("load", render, { once: true });
    } else {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [locale, onToken, siteKey]);

  useEffect(() => {
    if (!resetKey || !widgetRef.current || !window.turnstile) return;
    window.turnstile.reset(widgetRef.current);
    onToken("");
  }, [onToken, resetKey]);

  if (!siteKey) return <div className="turnstile-field"><small className="field-error" role="alert">{t("auth.turnstile.notConfigured")}</small></div>;
  return (
    <div className="turnstile-field" aria-describedby={error ? errorId : undefined}>
      <span className="field-label">{t("auth.turnstile.label")}</span>
      <div ref={containerRef} className="turnstile-container" aria-label={t("auth.turnstile.ariaLabel")} />
      {error && <small className="field-error" id={errorId}>{error}</small>}
    </div>
  );
}
