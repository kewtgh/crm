"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, LockKeyhole } from "lucide-react";

export function PasswordResetRequestForm() {
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
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) setError(result.error ?? "发送失败，请重试");
      else setSuccess(result.message ?? "重置邮件已发送");
    } catch {
      setError("网络连接异常，请稍后重试 / Network error, please try again");
    } finally {
      setPending(false);
    }
  }

  return <form className="auth-form" onSubmit={submit} noValidate>
    <div className="auth-form-heading"><p className="eyebrow">ACCOUNT RECOVERY</p><h1>重置密码</h1><p>输入账号邮箱，我们会发送安全重置链接。</p></div>
    <label className="field"><span>邮箱 / Email</span><input type="email" name="email" autoComplete="email" required /></label>
    {error && <div className="form-message error" role="alert"><LockKeyhole size={17} /><span>{error}</span></div>}
    {success && <div className="form-message success" role="status"><Check size={17} /><span>{success}</span></div>}
    <button className="primary-button auth-submit" type="submit" disabled={pending}>{pending && <LoaderCircle className="spin" size={18} />}发送重置链接</button>
    <p className="auth-switch"><Link href="/login">返回登录</Link></p>
  </form>;
}

export function NewPasswordForm() {
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
      setError("密码至少 10 位，并包含大写字母和数字。"); return;
    }
    if (password !== confirmPassword) { setError("两次密码不一致 / Passwords do not match"); return; }
    if (!accessToken) { setError("重置链接无效或已过期，请重新申请。"); return; }
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
      if (!response.ok) { setError("重置链接无效或已过期，请重新申请。"); return; }
      setSuccess("密码已更新。现在可以使用新密码登录。");
      setAccessToken("");
      event.currentTarget.reset();
    } catch {
      setError("暂时无法更新密码，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return <form className="auth-form" onSubmit={submit} noValidate>
    <div className="auth-form-heading"><p className="eyebrow">NEW PASSWORD</p><h1>设置新密码</h1><p>新密码至少 10 位，并包含大写字母和数字。</p></div>
    {!ready ? <div className="form-message" role="status"><LoaderCircle className="spin" size={17} /><span>正在验证重置链接…</span></div> : <>
      <label className="field"><span>新密码 / New password</span><input type="password" name="password" autoComplete="new-password" required /></label>
      <label className="field"><span>确认新密码 / Confirm password</span><input type="password" name="confirmPassword" autoComplete="new-password" required /></label>
      {error && <div className="form-message error" role="alert"><LockKeyhole size={17} /><span>{error}</span></div>}
      {success && <div className="form-message success" role="status"><Check size={17} /><span>{success}</span></div>}
      <button className="primary-button auth-submit" type="submit" disabled={pending || Boolean(success)}>{pending && <LoaderCircle className="spin" size={18} />}更新密码</button>
    </>}
    <p className="auth-switch"><Link href={success ? "/login" : "/forgot-password"}>{success ? "返回登录" : "重新申请链接"}</Link></p>
  </form>;
}
