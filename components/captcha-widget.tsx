"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Configuration, State, WidgetMethods } from "altcha/types";
import {
  fallbackFromTurnstile,
  type CaptchaAction,
  type CaptchaFallbackReason,
  type CaptchaProof,
  type CaptchaProviderState,
  type TurnstileFailureEvent,
} from "@/lib/captcha-types";
import { useI18n } from "./i18n-provider";
import { TurnstileWidget } from "./turnstile-widget";

type AltchaElement = HTMLElement & WidgetMethods;

const fallbackMessageKeys: Record<CaptchaFallbackReason, string> = {
  script_load_failed: "auth.captcha.fallback.script",
  load_timeout: "auth.captcha.fallback.timeout",
  component_error: "auth.captcha.fallback.component",
  verification_timeout: "auth.captcha.fallback.timeout",
  token_expired: "auth.captcha.fallback.expired",
  service_unavailable: "auth.captcha.fallback.service",
  not_configured: "auth.captcha.fallback.notConfigured",
};

function AltchaProviderWidget({
  action,
  fallbackReason,
  locale,
  resetKey,
  onProof,
}: {
  action: CaptchaAction;
  fallbackReason: CaptchaFallbackReason;
  locale: string;
  resetKey: number;
  onProof: (proof: CaptchaProof | null) => void;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "verified" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let widget: AltchaElement | null = null;

    const mount = async () => {
      try {
        await import("altcha/i18n");
        if (cancelled || !containerRef.current) return;
        widget = document.createElement("altcha-widget") as AltchaElement;
        const verified = (event: Event) => {
          const payload = (event as CustomEvent<{ payload?: string }>).detail?.payload;
          if (!payload) {
            setStatus("error");
            onProof(null);
            return;
          }
          setStatus("verified");
          onProof({ provider: "altcha", token: payload, fallbackReason });
        };
        const stateChanged = (event: Event) => {
          const state = (event as CustomEvent<{ state?: State }>).detail?.state;
          if (state === "error" || state === "expired") {
            setStatus("error");
            onProof(null);
          }
        };
        widget.addEventListener("verified", verified);
        widget.addEventListener("statechange", stateChanged);
        const configuration = {
          auto: "onload",
          challenge: `/api/captcha/challenge?action=${encodeURIComponent(action)}&reason=${encodeURIComponent(fallbackReason)}`,
          credentials: "same-origin",
          language: locale === "zh-CN" ? "zh-cn" : "en",
          name: "captcha-altcha",
          serverVerificationFields: false,
          serverVerificationTimeZone: false,
          timeout: 90_000,
          type: "checkbox",
          verifyUrl: `/api/captcha/verify?action=${encodeURIComponent(action)}&reason=${encodeURIComponent(fallbackReason)}`,
          workers: 1,
        } satisfies Partial<Configuration>;
        widget.setAttribute("configuration", JSON.stringify(configuration));
        containerRef.current.appendChild(widget);
        if (cancelled) {
          widget.removeEventListener("verified", verified);
          widget.removeEventListener("statechange", stateChanged);
          widget.remove();
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          onProof(null);
        }
      }
    };
    void mount();
    return () => {
      cancelled = true;
      widget?.remove();
    };
  }, [action, fallbackReason, locale, onProof, resetKey]);

  return (
    <div className="captcha-provider altcha-field" data-captcha-provider="altcha">
      <div ref={containerRef} className="altcha-container" aria-label={t("auth.captcha.altchaAriaLabel")} />
      <div className={`captcha-status ${status}`} role="status" aria-live="polite">
        <span>{t(`auth.captcha.altcha.${status}`)}</span>
      </div>
    </div>
  );
}

export function CaptchaWidget({
  action = "staff_login",
  onProof,
  resetKey,
  error,
  fallbackSignal = 0,
  fallbackReason = "service_unavailable",
}: {
  action?: CaptchaAction;
  onProof: (proof: CaptchaProof | null) => void;
  resetKey: number;
  error?: string;
  fallbackSignal?: number;
  fallbackReason?: CaptchaFallbackReason;
}) {
  const { locale, t } = useI18n();
  const errorId = `${useId().replace(/:/g, "")}-error`;
  const [providerState, setProviderState] = useState<CaptchaProviderState>({ provider: "turnstile" });

  const useFallback = useCallback((event: TurnstileFailureEvent) => {
    onProof(null);
    setProviderState(fallbackFromTurnstile(event));
  }, [onProof]);

  const handleTurnstileToken = useCallback((token: string) => {
    onProof(token ? { provider: "turnstile", token } : null);
  }, [onProof]);

  const activeProviderState: CaptchaProviderState = fallbackSignal > 0
    ? { provider: "altcha", fallbackReason }
    : providerState;
  const activeFallbackReason = activeProviderState.fallbackReason ?? fallbackReason;
  return (
    <div className="captcha-field" aria-describedby={error ? errorId : undefined}>
      <span className="field-label">{t("auth.captcha.label")}</span>
      {activeProviderState.provider === "turnstile" ? (
        <TurnstileWidget
          action={action}
          onFailure={useFallback}
          onToken={handleTurnstileToken}
          resetKey={resetKey}
        />
      ) : (
        <>
          <div className="captcha-fallback-notice" role="status" aria-live="polite">
            {t(fallbackMessageKeys[activeFallbackReason])}
          </div>
          <AltchaProviderWidget
            key={`${action}-${activeFallbackReason}-${resetKey}`}
            action={action}
            fallbackReason={activeFallbackReason}
            locale={locale}
            onProof={onProof}
            resetKey={resetKey}
          />
        </>
      )}
      {error && <small className="field-error" id={errorId}>{error}</small>}
    </div>
  );
}
