"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, LockKeyhole } from "lucide-react";
import { useI18n } from "./i18n-provider";
import { CaptchaWidget } from "./captcha-widget";
import type { CaptchaFallbackReason, CaptchaProof } from "@/lib/captcha-types";
import { passwordValueSchema } from "@/lib/validation";
import { fetchWithTimeout, isTimeoutError } from "@/lib/fetch-timeout";

export function PasswordResetRequestForm() {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [captchaProof,setCaptchaProof]=useState<CaptchaProof|null>(null);
  const [captchaResetKey,setCaptchaResetKey]=useState(0);
  const [captchaFallbackSignal,setCaptchaFallbackSignal]=useState(0);
  const [captchaFallbackReason,setCaptchaFallbackReason]=useState<CaptchaFallbackReason>("service_unavailable");
  const submissionInFlight=useRef(false);
  const handleCaptchaProof=useCallback((proof:CaptchaProof|null)=>setCaptchaProof(proof),[]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (success || submissionInFlight.current) return;
    submissionInFlight.current=true;
    let completed=false;
    setPending(true); setError(""); setSuccess("");
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    if(!captchaProof){setError(t("auth.error.captchaRequired"));setPending(false);submissionInFlight.current=false;return;}
    try {
      const response = await fetchWithTimeout("/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email,captchaProof }),
      }, 15_000);
      const result = (await response.json()) as { code?: string; error?:{details?:{fallbackReason?:string}} };
      if (!response.ok){
        const keys:Record<string,string>={INVALID_EMAIL:"auth.error.invalidEmail",AUTH_NOT_CONFIGURED:"auth.error.notConfigured",AUTH_UNAVAILABLE:"auth.error.unavailable",TOO_MANY_ATTEMPTS:"auth.error.rateLimited",CAPTCHA_REQUIRED:"auth.error.captchaRequired",CAPTCHA_INVALID:"auth.error.captchaFailed",CAPTCHA_REPLAYED:"auth.error.captchaExpired",CAPTCHA_NOT_CONFIGURED:"auth.error.captchaUnavailable",TURNSTILE_REQUIRED:"auth.error.captchaRequired",TURNSTILE_FAILED:"auth.error.turnstileFailed",TURNSTILE_UNAVAILABLE:"auth.error.turnstileUnavailable",TURNSTILE_NOT_CONFIGURED:"auth.turnstile.notConfigured"};
        const fallback=result.error?.details?.fallbackReason;
        if(fallback==="service_unavailable"||fallback==="not_configured"){
          setCaptchaProof(null);
          setCaptchaFallbackReason(fallback);
          setCaptchaFallbackSignal(value=>value+1);
          setError(t("auth.captcha.fallback.serverPrompt"));
        }else setError(t(keys[result.code??""]??"auth.error.retry"));
        setCaptchaProof(null);
        setCaptchaResetKey(value=>value+1);
      }
      else {completed=true;setSuccess(t("auth.reset.sent"));}
    } catch (caught) {
      setError(t(isTimeoutError(caught) ? "auth.error.timeout" : "auth.error.network"));
    } finally {
      setPending(false);
      if(!completed)submissionInFlight.current=false;
    }
  }

  return <form className="auth-form" onSubmit={submit} noValidate>
    <div className="auth-form-heading"><p className="eyebrow">{t("eyebrow.accountRecovery")}</p><h1>{t("auth.reset.title")}</h1><p>{t("auth.reset.requestDescription")}</p></div>
    <label className="field"><span>{t("auth.email")}</span><input type="email" name="email" autoComplete="email" required /></label>
    <CaptchaWidget action="password_recovery" onProof={handleCaptchaProof} resetKey={captchaResetKey} fallbackSignal={captchaFallbackSignal} fallbackReason={captchaFallbackReason}/>
    {error && <div className="form-message error" role="alert"><LockKeyhole size={17} /><span>{error}</span></div>}
    {success && <div className="form-message success" role="status"><Check size={17} /><span>{success}</span></div>}
    <button className="primary-button auth-submit" type="submit" disabled={pending || Boolean(success)}>{pending && <LoaderCircle className="spin" size={18} />}{t("auth.reset.send")}</button>
    <p className="auth-switch"><Link href="/login">{t("auth.goLogin")}</Link></p>
  </form>;
}

export function NewPasswordForm() {
  const { t } = useI18n();
  const [accessToken, setAccessToken] = useState("");
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const submissionInFlight=useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("access_token") ?? "";
    const type = params.get("type");
    window.history.replaceState(null, "", window.location.pathname);
    window.requestAnimationFrame(() => {
      if (type === "recovery" && token) setAccessToken(token);
      setReady(true);
    });
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current || success) return;
    setError(""); setSuccess("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (!passwordValueSchema.safeParse(password).success) {
      setError(t("auth.reset.passwordRule")); return;
    }
    if (password !== confirmPassword) { setError(t("auth.reset.mismatch")); return; }
    if (!accessToken) { setError(t("auth.reset.invalid")); return; }
    submissionInFlight.current=true;
    let completed=false;
    setPending(true);
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) throw new Error("missing configuration");
      const response = await fetchWithTimeout(`${supabaseUrl}/auth/v1/user`, {
        method: "PUT",
        headers: { apikey: anonKey, authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ password }),
      }, 15_000);
      if (!response.ok) { setError(t("auth.reset.invalid")); return; }
      completed=true;
      setSuccess(t("auth.reset.updated"));
      setAccessToken("");
      event.currentTarget.reset();
    } catch (caught) {
      setError(t(isTimeoutError(caught) ? "auth.error.timeout" : "auth.reset.unavailable"));
    } finally {
      setPending(false);
      if(!completed)submissionInFlight.current=false;
    }
  }

  return <form className="auth-form" onSubmit={submit} noValidate>
    <div className="auth-form-heading"><p className="eyebrow">{t("eyebrow.newPassword")}</p><h1>{t("auth.reset.newTitle")}</h1><p>{t("auth.reset.newDescription")}</p></div>
    {!ready ? <div className="form-message" role="status"><LoaderCircle className="spin" size={17} /><span>{t("auth.reset.verifying")}</span></div> : <>
      <label className="field"><span>{t("auth.reset.newPassword")}</span><input type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      <label className="field"><span>{t("auth.confirmPassword")}</span><input type="password" name="confirmPassword" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      <small className="field-help auth-password-rule">{t("auth.reset.passwordRule")}</small>
      {error && <div className="form-message error" role="alert"><LockKeyhole size={17} /><span>{error}</span></div>}
      {success && <div className="form-message success" role="status"><Check size={17} /><span>{success}</span></div>}
      <button className="primary-button auth-submit" type="submit" disabled={pending || Boolean(success)}>{pending && <LoaderCircle className="spin" size={18} />}{t("auth.reset.update")}</button>
    </>}
    <p className="auth-switch"><Link href={success ? "/login" : "/forgot-password"}>{t(success ? "auth.goLogin" : "auth.reset.requestAgain")}</Link></p>
  </form>;
}
