"use client";
/* eslint-disable @next/next/no-img-element -- the MFA QR code is supplied by the authenticated identity provider. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useI18n } from "./i18n-provider";
import { InlineMessage } from "./ui";
import { MfaAuthenticatorGuide } from "./mfa-authenticator-guide";
import { ApiClientError, apiFetch } from "@/lib/api-client";

export function InitialPasswordChangeForm() {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); setFieldError({});
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await apiFetch<{ next?: string }>("/api/auth/initial-password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values) });
      router.push(result.next ?? "/dashboard"); router.refresh();
    } catch (cause) {
      const code = cause instanceof ApiClientError ? cause.code : "";
      const field = cause instanceof ApiClientError && typeof cause.details?.field === "string" ? cause.details.field : "";
      const key = code === "PASSWORD_MISMATCH" ? "auth.firstLogin.mismatch" : ["PASSWORD_TOO_SHORT", "PASSWORD_TOO_LONG", "PASSWORD_COMPLEXITY"].includes(code) ? "auth.firstLogin.rule" : code === "NETWORK_ERROR" ? "auth.error.network" : "auth.firstLogin.failed";
      if (field) setFieldError({ [field]: t(key) }); else setError(t(key));
    }
    finally { setPending(false); }
  }
  return <form className="auth-form" onSubmit={submit} noValidate>
    <div className="auth-form-heading"><p className="eyebrow">{t("auth.firstLogin.eyebrow")}</p><h1>{t("auth.firstLogin.title")}</h1><p>{t("auth.firstLogin.description")}</p></div>
    <InlineMessage type="warning"><KeyRound size={17}/>{t("auth.firstLogin.notice")}</InlineMessage>
    <PasswordInput name="newPassword" label={t("auth.firstLogin.newPassword")} error={fieldError.newPassword}/>
    <PasswordInput name="confirmPassword" label={t("auth.confirmPassword")} error={fieldError.confirmPassword}/>
    <small className="field-help auth-password-rule">{t("auth.firstLogin.rule")}</small>
    {error && <InlineMessage type="error">{error}</InlineMessage>}
    <button className="primary-button auth-submit" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={18}/> : <ShieldCheck size={18}/>} {t("auth.firstLogin.submit")}</button>
  </form>;
}

function PasswordInput({ name, label, error }: { name: string; label: string; error?: string }) {
  return <label className="field"><span>{label}</span><input name={name} type="password" autoComplete="new-password" minLength={12} maxLength={128} required aria-invalid={Boolean(error)}/>{error && <small className="field-error">{error}</small>}</label>;
}

type Factor = { id: string; factor_type: string; status: string };
type Enrollment = { factorId: string; challengeId: string; qrCode: string; secret?: string };

export function MfaSecurityForm({ mode }: { mode: "setup" | "challenge" }) {
  const { t } = useI18n(); const router = useRouter();
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  const [factorId, setFactorId] = useState(""); const [challengeId, setChallengeId] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment>();

  useEffect(() => {
    let cancelled = false;
    const prepare = async () => {
      setPending(true); setError("");
      try {
        if (mode === "setup") {
          const result = await apiFetch<{ factor?: { id?: string; totp?: { qr_code?: string; secret?: string } }; challenge?: { id?: string } }>("/api/settings/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "enroll" }) });
          if (!result.factor?.id || !result.challenge?.id) throw new Error();
          if (!cancelled) setEnrollment({ factorId: result.factor.id, challengeId: result.challenge.id, qrCode: result.factor.totp?.qr_code ?? "", secret: result.factor.totp?.secret });
        } else {
          const factors = await apiFetch<{ factors?: Factor[] }>("/api/settings/mfa");
          const factor = factors.factors?.find((entry) => entry.factor_type === "totp" && entry.status === "verified");
          if (!factor) throw new Error();
          const result = await apiFetch<{ challenge?: { id?: string } }>("/api/settings/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "challenge", factorId: factor.id }) });
          if (!result.challenge?.id) throw new Error();
          if (!cancelled) { setFactorId(factor.id); setChallengeId(result.challenge.id); }
        }
      } catch { if (!cancelled) setError(t("auth.mfa.prepareFailed")); }
      finally { if (!cancelled) setPending(false); }
    };
    prepare(); return () => { cancelled = true; };
  }, [mode, t]);

  async function verify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    const currentFactorId = enrollment?.factorId ?? factorId; const currentChallengeId = enrollment?.challengeId ?? challengeId;
    try {
      const result = await apiFetch<{ next?: string }>("/api/settings/mfa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "verify", factorId: currentFactorId, challengeId: currentChallengeId, code }) });
      router.push(result.next ?? "/dashboard"); router.refresh();
    } catch (cause) { setError(t(cause instanceof ApiClientError && cause.code === "NETWORK_ERROR" ? "auth.error.network" : "auth.mfa.invalidCode")); }
    finally { setPending(false); }
  }

  const ready = mode === "setup" ? Boolean(enrollment) : Boolean(factorId && challengeId);
  return <form className="auth-form" onSubmit={verify} noValidate>
    <div className="auth-form-heading"><p className="eyebrow">{t("auth.mfa.eyebrow")}</p><h1>{t(mode === "setup" ? "auth.mfa.setupTitle" : "auth.mfa.challengeTitle")}</h1><p>{t(mode === "setup" ? "auth.mfa.setupDescription" : "auth.mfa.challengeDescription")}</p></div>
    {mode === "setup" && <MfaAuthenticatorGuide headingLevel="h2" />}
    {mode === "setup" && enrollment?.qrCode && <div className="mfa-enrollment"><img className="mfa-qr" src={enrollment.qrCode} alt={t("settings.mfaQrAlt")}/>{enrollment.secret && <small>{t("auth.mfa.manualSecret")} <code>{enrollment.secret}</code></small>}</div>}
    <label className="field"><span>{t("settings.mfaCode")}</span><input name="code" inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required disabled={!ready}/></label>
    {error && <InlineMessage type="error">{error}</InlineMessage>}
    <button className="primary-button auth-submit" type="submit" disabled={pending || !ready}>{pending && <LoaderCircle className="spin" size={18}/>}<ShieldCheck size={18}/>{t("auth.mfa.verify")}</button>
  </form>;
}
