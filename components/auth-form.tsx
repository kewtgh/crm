"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  GraduationCap,
  Languages,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useI18n } from "./i18n-provider";
import { LocaleSwitcher } from "./locale-switcher";
import { TurnstileWidget } from "./turnstile-widget";

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

export function AuthForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const handleTurnstileToken = useCallback((token: string) => setTurnstileToken(token), []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFormError("");
    setFieldErrors({});
    if (!turnstileToken) {
      setFieldErrors({ turnstile: t("auth.error.turnstileRequired") });
      setPending(false);
      return;
    }
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...Object.fromEntries(form.entries()), turnstileToken }),
      });
      const result = (await response.json()) as { code?: string; field?: string; next?: string };
      if (!response.ok) {
        // Turnstile tokens are single-use. Refresh after every server attempt,
        // including an incorrect password, so the next submission is valid.
        setTurnstileResetKey((value) => value + 1);
        const errorKeys: Record<string, string> = {
          INVALID_CREDENTIALS: "auth.error.invalidCredentials",
          INVALID_EMAIL: "auth.error.invalidEmail",
          PASSWORD_TOO_SHORT: "auth.error.passwordShort",
          AUTH_NOT_CONFIGURED: "auth.error.notConfigured",
          STAFF_ACCESS_DENIED: "auth.error.staffAccess",
          TOO_MANY_ATTEMPTS: "auth.error.tooManyAttempts",
          TURNSTILE_REQUIRED: "auth.error.turnstileRequired",
          TURNSTILE_FAILED: "auth.error.turnstileFailed",
          TURNSTILE_UNAVAILABLE: "auth.error.turnstileUnavailable",
          TURNSTILE_NOT_CONFIGURED: "auth.turnstile.notConfigured",
        };
        const message = t(errorKeys[result.code ?? ""] ?? "auth.error.retry");
        if (result.field === "turnstile") {
          setFieldErrors({ turnstile: message });
        } else if (result.field === "email" || result.field === "password") {
          setFieldErrors({ [result.field]: message });
        } else {
          setFormError(message);
        }
        return;
      }
      router.push(result.next ?? "/dashboard");
      router.refresh();
    } catch {
      setFormError(t("auth.error.network"));
      setTurnstileResetKey((value) => value + 1);
    } finally {
      setPending(false);
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

      <label className="field" htmlFor="email">
        <span>{t("auth.email")}</span>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
        />
        {fieldErrors.email && <small className="field-error" id="email-error">{fieldErrors.email}</small>}
      </label>

      <PasswordField error={fieldErrors.password} />

      <div className="login-extras">
        <label className="checkbox-field compact">
          <input type="checkbox" name="remember" />
          <span>{t("auth.remember")}</span>
        </label>
        <Link href="/forgot-password">{t("auth.forgot")}</Link>
      </div>

      <TurnstileWidget onToken={handleTurnstileToken} resetKey={turnstileResetKey} error={fieldErrors.turnstile} />

      {formError && (
        <div className="form-message error" role="alert">
          <LockKeyhole size={17} /> <span>{formError}</span>
        </div>
      )}

      <button className="primary-button auth-submit" type="submit" disabled={pending}>
        {pending && <LoaderCircle className="spin" size={18} />}
        {t("auth.login.submit")}
        {!pending && <ArrowRight size={18} />}
      </button>

    </form>
  );
}

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark"><GraduationCap size={23} /></span>
          <span><b>{t("brand.short")}</b><small>{t("brand.product")}</small></span>
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
        <p className="auth-help">{t("auth.help")}</p>
      </section>
    </main>
  );
}
