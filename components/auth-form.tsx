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
        <span>本地安全验证 / Local verification</span>
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
          aria-label={visible ? "隐藏密码" : "显示密码"}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  );
}

export function AuthForm({ mode, demoMode = false }: { mode: FormMode; demoMode?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const isLogin = mode === "login";

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
        setError(result.error ?? "操作未完成，请重试 / Please try again");
        if (result.field && result.field !== "form") {
          setFieldError({ [result.field]: result.error ?? "请检查此项" });
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
        setSuccess(result.message ?? "注册申请已提交");
        event.currentTarget.reset();
        setTurnstileToken("");
        window.dispatchEvent(new Event("crm:reset-turnstile"));
      }
    } catch {
      setError("网络连接异常，请稍后重试 / Network error, please try again");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <div className="auth-form-heading">
        <p className="eyebrow">{isLogin ? "SECURE SIGN IN" : "GUARDIAN REGISTRATION"}</p>
        <h1>{isLogin ? "欢迎回来" : "创建家长账户"}</h1>
        <p>
          {isLogin
            ? "登录 Lumina CRM，继续管理学校与家庭关系。"
            : "提交后由学校管理员验证监护关系，通常需要 1 个工作日。"}
        </p>
      </div>

      {!isLogin && (
        <div className="form-grid two-column">
          <label className="field" htmlFor="chineseName">
            <span>中文姓名 <b>*</b></span>
            <input id="chineseName" name="chineseName" autoComplete="name" placeholder="陈雅雯" required />
            {fieldError.chineseName && <small className="field-error">{fieldError.chineseName}</small>}
          </label>
          <label className="field" htmlFor="englishName">
            <span>English name <b>*</b></span>
            <input id="englishName" name="englishName" autoComplete="name" placeholder="Olivia Chen" required />
            {fieldError.englishName && <small className="field-error">{fieldError.englishName}</small>}
          </label>
        </div>
      )}

      <label className="field" htmlFor="email">
        <span>邮箱 / Email</span>
        <input id="email" name="email" type="email" autoComplete="email" placeholder="name@school.edu" required />
        {fieldError.email && <small className="field-error">{fieldError.email}</small>}
      </label>

      <PasswordField id="password" label="密码 / Password" autoComplete={isLogin ? "current-password" : "new-password"} />

      {!isLogin && (
        <>
          <p className="password-hint">至少 10 位，包含大写字母和数字 / 10+ characters with uppercase and number</p>
          <PasswordField id="confirmPassword" label="确认密码 / Confirm password" autoComplete="new-password" />
          {fieldError.confirmPassword && <small className="field-error standalone">{fieldError.confirmPassword}</small>}
          <TurnstileWidget onToken={setTurnstileToken} />
          <label className="checkbox-field">
            <input name="agreement" type="checkbox" required />
            <span>
              我同意 <Link href="/terms">服务条款</Link> 与 <Link href="/privacy">隐私政策</Link>
              <small>I agree to the Terms and Privacy Policy</small>
            </span>
          </label>
          {fieldError.agreement && <small className="field-error standalone">{fieldError.agreement}</small>}
        </>
      )}

      {isLogin && demoMode && (
        <div className="login-extras">
          <label className="checkbox-field compact">
            <input type="checkbox" name="remember" />
            <span>在此设备保持登录</span>
          </label>
          <Link href="/forgot-password">忘记密码？</Link>
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
        {isLogin ? "安全登录 / Sign in" : "提交注册申请 / Submit application"}
        {!pending && <ArrowRight size={18} />}
      </button>

      {isLogin && (
        <div className="demo-note">
          <Sparkles size={16} />
          <span>本地演示：admin@lumina-edu.com · Demo123!</span>
        </div>
      )}

      <p className="auth-switch">
        {isLogin ? "家长还没有账户？" : "已经有账户？"}{" "}
        <Link href={isLogin ? "/register" : "/login"}>
          {isLogin ? "单独注册" : "返回登录"}
        </Link>
      </p>
    </form>
  );
}

export function AuthLayout({ children }: { children: React.ReactNode; mode: FormMode }) {
  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark"><GraduationCap size={23} /></span>
          <span><b>Lumina</b><small>Education CRM</small></span>
        </Link>
        <div className="auth-brand-copy">
          <p className="eyebrow">RELATIONSHIPS, CLEARLY SEEN</p>
          <h2>让每一段教育关系，都有清晰的下一步。</h2>
          <p>学校、学生、家庭与团队，在同一套可信、克制而智能的工作空间中协同。</p>
          <div className="trust-points">
            <span><ShieldCheck size={18} /> 权限隔离与审计</span>
            <span><Languages size={18} /> 中英双语资料</span>
            <span><Sparkles size={18} /> AI 建议，人来确认</span>
          </div>
        </div>
        <div className="brand-orbit" aria-hidden="true"><span /><span /><span /></div>
        <p className="auth-brand-footer">© 2026 Lumina Education · Taipei / Shanghai / Singapore</p>
      </section>
      <section className="auth-form-panel">
        <div className="language-chip"><Languages size={15} /> 中文 / EN</div>
        {children}
        <p className="auth-help">需要帮助？ support@lumina-edu.com</p>
      </section>
    </main>
  );
}
