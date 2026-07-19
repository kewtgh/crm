"use client";

import { useEffect, useId, useRef, useState } from "react";
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

export function TurnstileWidget({ onToken, resetKey, error, action="staff_login" }: { onToken: (token: string) => void; resetKey: number; error?: string; action?:string }) {
  const { locale, t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "verified" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const errorId = `${useId().replace(/:/g, "")}-error`;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const retry = () => {
    if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
    widgetRef.current = null;
    if (!window.turnstile) document.getElementById(SCRIPT_ID)?.remove();
    setStatus("loading");
    setAttempt((value) => value + 1);
  };

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!cancelled && !widgetRef.current) setStatus("error");
    }, 12_000);
    const render = () => {
      if (cancelled || !siteKey || !containerRef.current || !window.turnstile || widgetRef.current) return;
      widgetRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        language: locale === "zh-CN" ? "zh-CN" : "en",
        theme: "light",
        size: "flexible",
        action,
        callback: (token: string) => { setStatus("verified"); onToken(token); },
        "before-interactive-callback": () => setStatus("ready"),
        "expired-callback": () => { setStatus("ready"); onToken(""); },
        "error-callback": () => { setStatus("error"); onToken(""); },
      });
      setStatus("ready");
    };
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (window.turnstile) render(); else {
        existing.addEventListener("load", render, { once: true });
        existing.addEventListener("error", () => setStatus("error"), { once: true });
      }
    } else {
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", () => setStatus("error"), { once: true });
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, [action, attempt, locale, onToken, siteKey]);

  useEffect(() => {
    if (!resetKey || !widgetRef.current || !window.turnstile) return;
    window.turnstile.reset(widgetRef.current);
    setStatus("ready");
    onToken("");
  }, [onToken, resetKey]);

  if (!siteKey) return <div className="turnstile-field"><small className="field-error" role="alert">{t("auth.turnstile.notConfigured")}</small></div>;
  return (
    <div className="turnstile-field" aria-describedby={error ? errorId : undefined}>
      <span className="field-label">{t("auth.turnstile.label")}</span>
      <div ref={containerRef} className="turnstile-container" aria-label={t("auth.turnstile.ariaLabel")} />
      <div className={`turnstile-status ${status}`} role="status" aria-live="polite">
        <span>{t(`auth.turnstile.${status}`)}</span>
        {status === "error" && <button type="button" onClick={retry}>{t("common.retry")}</button>}
      </div>
      {error && <small className="field-error" id={errorId}>{error}</small>}
    </div>
  );
}
