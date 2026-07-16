"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
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

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

type FormMode = "login" | "register";

function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    const render = () => {
      if (!window.turnstile || !containerRef.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action: "guardian_registration",
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => {
          onToken("");
          window.setTimeout(() => window.turnstile?.reset(widgetId.current), 800);
        },
        theme: "light",
        size: "flexible",
      });
    };
    const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
    if (existing) {
      render();
      existing.addEventListener("load", render, { once: true });
    }
    else {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.turnstile = "true";
      script.onload = render;
      document.head.appendChild(script);
    }
    return () => {
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = undefined;
      }
      existing?.removeEventListener("load", render);
    };
  }, [onToken, siteKey]);

  useEffect(() => {
    const refresh = () => {
      if (widgetId.current) window.turnstile?.reset(widgetId.current);
    };
    window.addEventListener("crm:reset-turnstile", refresh);
    return () => window.removeEventListener("crm:reset-turnstile", refresh);
  }, []);

  if (!siteKey) {
    return (
      <div className="turnstile-placeholder" role="status">
        <ShieldCheck size={18} />
        <span>{t("auth.localVerification")}</span>
        <Check size={16} />
      </div>
    );
  }
  return <div className="turnstile-shell" ref={containerRef} />;
}

function PasswordField({
  id,
  label,
  autoComplete,
  required = true,
}: {
  id: string;
  label: string;
  autoComplete: string;
  required?: boolean;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <span className="password-control">
        <input
          id={id}
          name={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          required={required}
          minLength={8}
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
    </label>
  );
}

export function AuthForm({ mode, demoMode = false }: { mode: FormMode; demoMode?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"" | "checking" | "available">("");
  const isLogin = mode === "login";

  async function checkUsername(value: string) {
    const username = value.trim().toLowerCase();
    setUsernameStatus("");
    setFieldError((current) => { const next = { ...current }; delete next.username; return next; });
    if (!/^[a-z][a-z0-9._-]{2,31}$/.test(username)) { setFieldError((current) => ({ ...current, username: t("auth.error.usernameInvalid") })); return; }
    setUsernameStatus("checking");
    try {
      const response = await fetch("/api/auth/check-username", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username }) });
      const result = (await response.json()) as { available?: boolean };
      if (!response.ok) setFieldError((current) => ({ ...current, username: t("auth.error.usernameCheck") }));
      else if (!result.available) setFieldError((current) => ({ ...current, username: t("auth.error.usernameTaken") }));
      else setUsernameStatus("available");
    } catch { setFieldError((current) => ({ ...current, username: t("auth.error.usernameCheck") })); }
    finally { setUsernameStatus((current) => current === "checking" ? "" : current); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setFieldError({});
    setSuccess("");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = Object.fromEntries(form.entries());
    if (!isLogin) {
      payload.agreement = form.get("agreement") === "on";
      payload.turnstileToken = turnstileToken;
    }
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as {
        error?: string;
        field?: string;
        code?: string;
        message?: string;
      };
      if (!response.ok) {
        const errorKeys: Record<string, string> = { TURNSTILE_FAILED: "auth.error.verificationExpired", INVALID_CREDENTIALS: "auth.error.invalidCredentials", AUTH_NOT_CONFIGURED: "auth.error.notConfigured", STAFF_ACCESS_DENIED: "auth.error.staffAccess", DUPLICATE: "auth.error.duplicate", INVALID_INPUT: "auth.error.invalid", INVALID_EMAIL: "auth.error.invalidEmail", PASSWORD_TOO_SHORT: "auth.error.passwordShort", PASSWORD_NEEDS_UPPERCASE: "auth.error.passwordUppercase", PASSWORD_NEEDS_NUMBER: "auth.error.passwordNumber", CHINESE_NAME_REQUIRED: "auth.error.chineseName", ENGLISH_NAME_REQUIRED: "auth.error.englishName", AGREEMENT_REQUIRED: "auth.error.agreement", PASSWORD_MISMATCH: "auth.reset.mismatch", REGISTRATION_UNAVAILABLE: "auth.error.registrationUnavailable", USERNAME_TAKEN: "auth.error.usernameTaken", USERNAME_INVALID: "auth.error.usernameInvalid", USERNAME_TOO_SHORT: "auth.error.usernameInvalid", USERNAME_TOO_LONG: "auth.error.usernameInvalid", USERNAME_CHECK_UNAVAILABLE: "auth.error.usernameCheck" };
        const errorKey = errorKeys[result.code ?? ""] ?? "auth.error.retry";
        setError(t(errorKey));
        if (result.field && result.field !== "form") {
          setFieldError({ [result.field]: t(errorKey === "auth.error.retry" ? "auth.error.checkField" : errorKey) });
        }
        if (result.code === "TURNSTILE_FAILED") {
          setTurnstileToken("");
          window.dispatchEvent(new Event("crm:reset-turnstile"));
        }
        return;
      }
      if (isLogin) {
        router.push("/dashboard");
        router.refresh();
      } else {
        setSuccess(t("auth.registrationSubmitted"));
        event.currentTarget.reset();
        setTurnstileToken("");
        window.dispatchEvent(new Event("crm:reset-turnstile"));
      }
    } catch {
      setError(t("auth.error.network"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" method="post" action={`/api/auth/${mode}`} onSubmit={submit} noValidate>
      <div className="auth-form-heading">
        <p className="eyebrow">{t(isLogin ? "eyebrow.secureSignIn" : "eyebrow.guardianRegistration")}</p>
        <h1>{t(isLogin ? "auth.login.title" : "auth.register.title")}</h1>
        <p>{t(isLogin ? "auth.login.subtitle" : "auth.register.subtitle")}</p>
      </div>

      {!isLogin && (
        <>
        <label className="field" htmlFor="username"><span>{t("auth.username")} <b>*</b></span><input id="username" name="username" autoComplete="username" placeholder="olivia.chen" pattern="[a-z][a-z0-9._-]{2,31}" onBlur={(event)=>checkUsername(event.currentTarget.value)} required /><small className="field-help">{t("auth.usernameHelp")}</small>{usernameStatus === "checking" && <small className="field-help">{t("auth.usernameChecking")}</small>}{usernameStatus === "available" && <small className="field-success"><Check size={13}/>{t("auth.usernameAvailable")}</small>}{fieldError.username && <small className="field-error">{fieldError.username}</small>}</label>
        <div className="form-grid two-column">
          <label className="field" htmlFor="chineseName">
            <span>{t("auth.chineseName")} <b>*</b></span>
            <input id="chineseName" name="chineseName" autoComplete="name" placeholder="陈雅雯" required />
            {fieldError.chineseName && <small className="field-error">{fieldError.chineseName}</small>}
          </label>
          <label className="field" htmlFor="englishName">
            <span>{t("auth.englishName")} <b>*</b></span>
            <input id="englishName" name="englishName" autoComplete="name" placeholder="Olivia Chen" required />
            {fieldError.englishName && <small className="field-error">{fieldError.englishName}</small>}
          </label>
        </div>
        </>
      )}

      <label className="field" htmlFor="email">
        <span>{t("auth.email")}</span>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="name@school.edu" required />
        {fieldError.email && <small className="field-error">{fieldError.email}</small>}
      </label>

      <PasswordField id="password" label={t("auth.password")} autoComplete={isLogin ? "current-password" : "new-password"} />

      {!isLogin && (
        <>
          <p className="password-hint">{t("auth.passwordHint")}</p>
          <PasswordField id="confirmPassword" label={t("auth.confirmPassword")} autoComplete="new-password" />
          {fieldError.confirmPassword && <small className="field-error standalone">{fieldError.confirmPassword}</small>}
          <TurnstileWidget onToken={setTurnstileToken} />
          <label className="checkbox-field">
            <input name="agreement" type="checkbox" required />
            <span>
              {t("auth.agreement")} <Link href="/terms">{t("legal.terms")}</Link> · <Link href="/privacy">{t("legal.privacy")}</Link>
            </span>
          </label>
          {fieldError.agreement && <small className="field-error standalone">{fieldError.agreement}</small>}
        </>
      )}

      {isLogin && (
        <div className="login-extras">
          <label className="checkbox-field compact">
            <input type="checkbox" name="remember" />
            <span>{t("auth.remember")}</span>
          </label>
          <Link href="/forgot-password">{t("auth.forgot")}</Link>
        </div>
      )}

      {error && (
        <div className="form-message error" role="alert">
          <LockKeyhole size={17} /> <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="form-message success" role="status">
          <Check size={17} /> <span>{success}</span>
        </div>
      )}

      <button className="primary-button auth-submit" type="submit" disabled={pending}>
        {pending ? <LoaderCircle className="spin" size={18} /> : null}
        {t(isLogin ? "auth.login.submit" : "auth.submitApplication")}
        {!pending && <ArrowRight size={18} />}
      </button>

      {isLogin && demoMode && (
        <div className="demo-note">
          <Sparkles size={16} />
          <span>{t("auth.demo")}</span>
        </div>
      )}

      <p className="auth-switch">
        {t(isLogin ? "auth.noAccount" : "auth.hasAccount")}{" "}
        <Link href={isLogin ? "/register" : "/login"}>
          {t(isLogin ? "auth.goRegister" : "auth.goLogin")}
        </Link>
      </p>
    </form>
  );
}

export function AuthLayout({ children }: { children: React.ReactNode; mode: FormMode }) {
  const { t } = useI18n();
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark"><GraduationCap size={23} /></span>
          <span><b>Lumina</b><small>Education CRM</small></span>
        </Link>
        <div className="auth-brand-copy">
          <p className="eyebrow">{t("auth.brandEyebrow")}</p>
          <h2>{t("auth.brandTitle")}</h2>
          <p>{t("auth.brandDescription")}</p>
          <div className="trust-points">
            <span><ShieldCheck size={18} /> {t("auth.trust.permissions")}</span>
            <span><Languages size={18} /> {t("auth.trust.bilingualData")}</span>
            <span><Sparkles size={18} /> {t("auth.trust.ai")}</span>
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
