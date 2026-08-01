"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Languages,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useI18n } from "./i18n-provider";
import { LocaleSwitcher } from "./locale-switcher";
import { CaptchaWidget } from "./captcha-widget";
import type { CaptchaFallbackReason, CaptchaProof } from "@/lib/captcha-types";
import { fetchWithTimeout, isTimeoutError } from "@/lib/fetch-timeout";

function PasswordField({ error }: { error?: string }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <label className="field" htmlFor="password">
      <span>{t("auth.password")}</span>
      <span className="password-control">
        <input
          id="password"
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="current-password"
          required
          minLength={8}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "password-error" : undefined}
        />
        <button
          type="button"
          className="field-icon-button"
          onClick={() => setVisible((value) => !value)}
          aria-label={t(visible ? "auth.hidePassword" : "auth.showPassword")}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
      {error && <small className="field-error" id="password-error">{error}</small>}
    </label>
  );
}

export function AuthForm({ ssoEnabled = false, turnstileEnabled = true, initialErrorCode, initialNoticeCode }: { ssoEnabled?: boolean; turnstileEnabled?: boolean | null; initialErrorCode?: string; initialNoticeCode?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [ssoPending, setSsoPending] = useState(false);
  const submissionInFlight = useRef(false);
  const identifierRef = useRef<HTMLInputElement>(null);
  const ssoErrorKeys: Record<string, string> = {
    SSO_STATE_INVALID: "auth.sso.stateInvalid",
    SSO_STAFF_ACCESS_DENIED: "auth.sso.staffAccess",
    SSO_UNAVAILABLE: "auth.sso.unavailable",
  };
  const [formError, setFormError] = useState(initialErrorCode ? t(ssoErrorKeys[initialErrorCode] ?? "auth.sso.failed") : "");
  const securityNoticeKey = initialNoticeCode === "PASSWORD_CHANGED"
    ? "auth.security.passwordChanged"
    : initialNoticeCode === "PASSWORD_CHANGED_REVIEW_SESSIONS"
      ? "auth.security.passwordChangedReview"
      : "";
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [captchaProof, setCaptchaProof] = useState<CaptchaProof | null>(null);
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [captchaFallbackSignal, setCaptchaFallbackSignal] = useState(0);
  const [captchaFallbackReason, setCaptchaFallbackReason] = useState<CaptchaFallbackReason>("service_unavailable");
  const handleCaptchaProof = useCallback((proof: CaptchaProof | null) => setCaptchaProof(proof), []);
  const resetCaptcha = () => {
    setCaptchaProof(null);
    setCaptchaResetKey((value) => value + 1);
  };
  const applyServerCaptchaFallback = (reason: unknown) => {
    if (reason !== "service_unavailable" && reason !== "not_configured" && reason !== "administrator_disabled") return false;
    setCaptchaProof(null);
    setCaptchaFallbackReason(reason);
    setCaptchaFallbackSignal((value) => value + 1);
    return true;
  };

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    let navigationStarted = false;
    setPending(true);
    setFormError("");
    setFieldErrors({});
    if (!captchaProof) {
      setFieldErrors({ captcha: t("auth.error.captchaRequired") });
      setPending(false);
      submissionInFlight.current = false;
      return;
    }
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetchWithTimeout("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(form.entries()), captchaProof }),
      }, 15_000);
      const result = (await response.json()) as {
        code?: string;
        field?: string;
        next?: string;
        error?: { details?: { field?: string; fallbackReason?: string } };
      };
      if (!response.ok) {
        // Both Turnstile tokens and local attestations are single-use.
        resetCaptcha();
        const errorKeys: Record<string, string> = {
          INVALID_CREDENTIALS: "auth.error.invalidCredentials",
          INVALID_IDENTIFIER: "auth.error.invalidIdentifier",
          PASSWORD_TOO_SHORT: "auth.error.passwordShort",
          AUTH_NOT_CONFIGURED: "auth.error.notConfigured",
          STAFF_ACCESS_DENIED: "auth.error.staffAccess",
          TOO_MANY_ATTEMPTS: "auth.error.tooManyAttempts",
          CAPTCHA_REQUIRED: "auth.error.captchaRequired",
          CAPTCHA_INVALID: "auth.error.captchaFailed",
          CAPTCHA_REPLAYED: "auth.error.captchaExpired",
          CAPTCHA_NOT_CONFIGURED: "auth.error.captchaUnavailable",
          TURNSTILE_REQUIRED: "auth.error.captchaRequired",
          TURNSTILE_FAILED: "auth.error.turnstileFailed",
          TURNSTILE_UNAVAILABLE: "auth.error.turnstileUnavailable",
          TURNSTILE_NOT_CONFIGURED: "auth.turnstile.notConfigured",
          AUTH_UNAVAILABLE: "auth.error.unavailable",
          EMAIL_VERIFICATION_UNAVAILABLE: "auth.error.unavailable",
        };
        const message = t(errorKeys[result.code ?? ""] ?? "auth.error.retry");
        const details = result.error?.details;
        const field = result.field ?? details?.field;
        if (applyServerCaptchaFallback(details?.fallbackReason)) {
          setFieldErrors({ captcha: t("auth.captcha.fallback.serverPrompt") });
        } else if (field === "captcha" || field === "turnstile") {
          setFieldErrors({ captcha: message });
        } else if (field === "identifier" || field === "password") {
          setFieldErrors({ [field]: message });
        } else {
          setFormError(message);
        }
        return;
      }
      navigationStarted = true;
      router.push(result.next ?? "/dashboard");
      router.refresh();
    } catch (error) {
      setFormError(t(isTimeoutError(error) ? "auth.error.timeout" : "auth.error.network"));
      resetCaptcha();
    } finally {
      if (!navigationStarted) {
        submissionInFlight.current = false;
        setPending(false);
      }
    }
  }

  async function beginSso() {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    let navigationStarted = false;
    setFormError("");
    setFieldErrors({});
    const identifier = identifierRef.current?.value.trim() ?? "";
    if (!identifier.includes("@")) {
      setFieldErrors({ identifier: t("auth.sso.emailRequired") });
      submissionInFlight.current = false;
      return;
    }
    if (!captchaProof) {
      setFieldErrors({ captcha: t("auth.error.captchaRequired") });
      submissionInFlight.current = false;
      return;
    }
    setSsoPending(true);
    try {
      const response = await fetchWithTimeout("/api/auth/sso", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: identifier, captchaProof }),
      }, 15_000);
      const result = await response.json() as {
        url?: string;
        code?: string;
        error?: { details?: { field?: string; fallbackReason?: string } };
      };
      if (!response.ok || !result.url) {
        const errorKeys: Record<string, string> = {
          INVALID_SSO_EMAIL: "auth.sso.emailRequired",
          SSO_DOMAIN_NOT_ALLOWED: "auth.sso.domainNotAllowed",
          SSO_NOT_CONFIGURED: "auth.sso.unavailable",
          SSO_PROVIDER_REJECTED: "auth.sso.failed",
          TOO_MANY_ATTEMPTS: "auth.error.tooManyAttempts",
          CAPTCHA_REQUIRED: "auth.error.captchaRequired",
          CAPTCHA_INVALID: "auth.error.captchaFailed",
          CAPTCHA_REPLAYED: "auth.error.captchaExpired",
          CAPTCHA_NOT_CONFIGURED: "auth.error.captchaUnavailable",
          TURNSTILE_REQUIRED: "auth.error.captchaRequired",
          TURNSTILE_FAILED: "auth.error.turnstileFailed",
          TURNSTILE_UNAVAILABLE: "auth.error.turnstileUnavailable",
        };
        const fallbackApplied = applyServerCaptchaFallback(result.error?.details?.fallbackReason);
        if (fallbackApplied) {
          setFieldErrors({ captcha: t("auth.captcha.fallback.serverPrompt") });
        } else {
          setFormError(t(errorKeys[result.code ?? ""] ?? "auth.sso.failed"));
        }
        resetCaptcha();
        return;
      }
      navigationStarted = true;
      window.location.assign(result.url);
    } catch (error) {
      setFormError(t(isTimeoutError(error) ? "auth.error.timeout" : "auth.sso.unavailable"));
      resetCaptcha();
    } finally {
      if (!navigationStarted) {
        submissionInFlight.current = false;
        setSsoPending(false);
      }
    }
  }

  return (
    <form className="auth-form" method="post" action="/api/auth/login" onSubmit={submit} noValidate>
      <div className="auth-form-heading">
        <p className="eyebrow">{t("eyebrow.secureSignIn")}</p>
        <h1>{t("auth.login.title")}</h1>
        <p>{t("auth.login.subtitle")}</p>
      </div>

      <div className="form-message" role="note">
        <ShieldCheck size={17} />
        <span><b>{t("auth.staffOnly")}</b><br />{t("auth.staffOnlyHelp")}</span>
      </div>

      {securityNoticeKey && (
        <div className={`form-message ${initialNoticeCode === "PASSWORD_CHANGED" ? "success" : "warning"}`} role="status">
          <ShieldCheck size={17} />
          <span>{t(securityNoticeKey)}</span>
        </div>
      )}

      <label className="field" htmlFor="identifier">
        <span>{t("auth.identifier")}</span>
        <input
          id="identifier"
          name="identifier"
          type="text"
          ref={identifierRef}
          autoComplete="username"
          required
          aria-invalid={Boolean(fieldErrors.identifier)}
          aria-describedby={fieldErrors.identifier ? "identifier-error" : undefined}
        />
        {fieldErrors.identifier && <small className="field-error" id="identifier-error">{fieldErrors.identifier}</small>}
      </label>

      <PasswordField error={fieldErrors.password} />

      <div className="login-extras">
        <label className="checkbox-field compact">
          <input type="checkbox" name="remember" />
          <span>{t("auth.rememberDevice")}</span>
        </label>
        <Link href="/forgot-password">{t("auth.forgot")}</Link>
      </div>
      <p className="auth-session-policy"><ShieldCheck size={15} />{t("auth.sessionDuration")}</p>

      <CaptchaWidget
        onProof={handleCaptchaProof}
        resetKey={captchaResetKey}
        error={fieldErrors.captcha}
        fallbackSignal={captchaFallbackSignal}
        fallbackReason={captchaFallbackReason}
        turnstileEnabled={turnstileEnabled}
      />

      {formError && (
        <div className="form-message error" role="alert">
          <LockKeyhole size={17} /> <span>{formError}</span>
        </div>
      )}

      <button className="primary-button auth-submit" type="submit" disabled={pending || ssoPending}>
        {pending && <LoaderCircle className="spin" size={18} />}
        {t("auth.login.submit")}
        {!pending && <ArrowRight size={18} />}
      </button>

      {ssoEnabled && <div className="enterprise-sso-entry">
        <span>{t("auth.sso.or")}</span>
        <button className="secondary-button" type="button" disabled={pending || ssoPending} onClick={() => void beginSso()}>
          {ssoPending ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
          {t("auth.sso.submit")}
        </button>
        <small>{t("auth.sso.help")}</small>
      </div>}

    </form>
  );
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link className="brand-lockup" href="/" aria-label={t("brand.name")}>
          <span className="brand-logo-surface">
            <Image className="brand-logo" src="/brand/weiai-logo-800x240.png" width={800} height={240} alt={t("brand.name")} priority />
          </span>
        </Link>
        <div className="auth-brand-copy">
          <p className="eyebrow">{t("auth.brandEyebrow")}</p>
          <h2>{t("auth.brandTitle")}</h2>
          <p>{t("auth.brandDescription")}</p>
          <div className="trust-points">
            <span><ShieldCheck size={18} /> {t("auth.trust.permissions")}</span>
            <span><Languages size={18} /> {t("auth.trust.bilingualData")}</span>
            <span><Sparkles size={18} /> {t("auth.trust.rules")}</span>
          </div>
        </div>
        <div className="brand-orbit" aria-hidden="true"><span /><span /><span /></div>
        <p className="auth-brand-footer">{t("auth.brandFooter")}</p>
      </section>
      <section className="auth-form-panel">
        <div className="language-chip"><LocaleSwitcher compact /></div>
        {children}
        <p className="auth-help">{t("auth.help")} <a href="mailto:support@example.com">{t("auth.helpEmail")}</a></p>
      </section>
    </main>
  );
}
