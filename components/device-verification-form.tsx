"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, MailCheck, ShieldCheck } from "lucide-react";
import { ApiClientError, apiFetch } from "@/lib/api-client";
import { useI18n } from "./i18n-provider";
import { InlineMessage } from "./ui";

export function DeviceVerificationForm({ remembered }: { remembered: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    try {
      const result = await apiFetch<{ next?: string }>("/api/auth/device-verification", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      router.push(result.next ?? "/dashboard");
      router.refresh();
    } catch (cause) {
      const code = cause instanceof ApiClientError ? cause.code : "NETWORK_ERROR";
      const keys: Record<string, string> = {
        INVALID_DEVICE_CODE: "auth.device.invalidCode",
        DEVICE_VERIFICATION_EXPIRED: "auth.device.expired",
        TOO_MANY_ATTEMPTS: "auth.error.tooManyAttempts",
        NETWORK_ERROR: "auth.error.network",
      };
      setError(t(keys[code] ?? "auth.device.failed"));
    } finally {
      setPending(false);
    }
  }

  return <form className="auth-form" onSubmit={verify} noValidate>
    <div className="auth-form-heading">
      <p className="eyebrow">{t("auth.device.eyebrow")}</p>
      <h1>{t("auth.device.title")}</h1>
      <p>{t("auth.device.description")}</p>
    </div>
    <InlineMessage type="info"><MailCheck size={17}/>{t("auth.device.sent")}</InlineMessage>
    <label className="field">
      <span>{t("auth.device.code")}</span>
      <input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required autoFocus />
    </label>
    {remembered && <InlineMessage type="success"><ShieldCheck size={17}/>{t("auth.device.remembered")}</InlineMessage>}
    {error && <InlineMessage type="error"><KeyRound size={17}/>{error}</InlineMessage>}
    <button className="primary-button auth-submit" type="submit" disabled={pending}>
      {pending ? <LoaderCircle className="spin" size={18}/> : <ShieldCheck size={18}/>}
      {t("auth.device.verify")}
    </button>
    <Link className="auth-secondary-link" href="/login">{t("auth.device.restart")}</Link>
  </form>;
}
