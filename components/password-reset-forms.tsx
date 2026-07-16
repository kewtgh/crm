"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, LockKeyhole } from "lucide-react";
import { useI18n } from "./i18n-provider";

export function PasswordResetRequestForm() {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true); setError(""); setSuccess("");
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { code?: string };
      if (!response.ok) setError(t(result.code === "INVALID_EMAIL" ? "auth.error.invalidEmail" : result.code === "AUTH_NOT_CONFIGURED" ? "auth.error.notConfigured" : "auth.error.retry"));
      else setSuccess(t("auth.reset.sent"));
    } catch {
      setError(t("auth.error.network"));
    } finally {
      setPending(false);
    }
  }

  return <form className="auth-form" onSubmit={submit} noValidate>
    <div className="auth-form-heading"><p className="eyebrow">ACCOUNT RECOVERY</p><h1>{t("auth.reset.title")}</h1><p>{t("auth.reset.requestDescription")}</p></div>
    <label className="field"><span>{t("auth.email")}</span><input type="email" name="email" autoComplete="email" required /></label>
    {error && <div className="form-message error" role="alert"><LockKeyhole size={17} /><span>{error}</span></div>}
    {success && <div className="form-message success" role="status"><Check size={17} /><span>{success}</span></div>}
    <button className="primary-button auth-submit" type="submit" disabled={pending}>{pending && <LoaderCircle className="spin" size={18} />}{t("auth.reset.send")}</button>
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
    setError(""); setSuccess("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (password.length < 10 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      setError(t("auth.reset.passwordRule")); return;
    }
    if (password !== confirmPassword) { setError(t("auth.reset.mismatch")); return; }
    if (!accessToken) { setError(t("auth.reset.invalid")); return; }
    setPending(true);
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) throw new Error("missing configuration");
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        method: "PUT",
        headers: { apikey: anonKey, authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) { setError(t("auth.reset.invalid")); return; }
      setSuccess(t("auth.reset.updated"));
      setAccessToken("");
      event.currentTarget.reset();
    } catch {
      setError(t("auth.reset.unavailable"));
    } finally {
      setPending(false);
    }
  }

  return <form className="auth-form" onSubmit={submit} noValidate>
    <div className="auth-form-heading"><p className="eyebrow">NEW PASSWORD</p><h1>{t("auth.reset.newTitle")}</h1><p>{t("auth.reset.newDescription")}</p></div>
    {!ready ? <div className="form-message" role="status"><LoaderCircle className="spin" size={17} /><span>{t("auth.reset.verifying")}</span></div> : <>
      <label className="field"><span>{t("auth.reset.newPassword")}</span><input type="password" name="password" autoComplete="new-password" required /></label>
      <label className="field"><span>{t("auth.confirmPassword")}</span><input type="password" name="confirmPassword" autoComplete="new-password" required /></label>
      {error && <div className="form-message error" role="alert"><LockKeyhole size={17} /><span>{error}</span></div>}
      {success && <div className="form-message success" role="status"><Check size={17} /><span>{success}</span></div>}
      <button className="primary-button auth-submit" type="submit" disabled={pending || Boolean(success)}>{pending && <LoaderCircle className="spin" size={18} />}{t("auth.reset.update")}</button>
    </>}
    <p className="auth-switch"><Link href={success ? "/login" : "/forgot-password"}>{t(success ? "auth.goLogin" : "auth.reset.requestAgain")}</Link></p>
  </form>;
}
