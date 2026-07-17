"use client";

import Link from "next/link";
import { useState } from "react";
import { Ban, CheckCircle2, History, MailCheck, ShieldCheck } from "lucide-react";
import type { ContactPrivacy } from "@/lib/phase2-repository";
import { useI18n } from "./i18n-provider";
import { InlineMessage, StatusBadge, Toast } from "./ui";

export function ContactConsentPage({ initial }: { initial: ContactPrivacy }) {
  const { t } = useI18n();
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [dncError, setDncError] = useState("");
  const [dncOpen, setDncOpen] = useState(false);
  const [dncReason, setDncReason] = useState("");
  const [toast, setToast] = useState("");

  const reload = async () => {
    const response = await fetch(`/api/contacts/${initial.id}/consents`);
    if (response.ok) setData(await response.json() as ContactPrivacy);
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setConsentError("");
    const form = new FormData(event.currentTarget);
    const body = { operation: "consent", channel: form.get("channel"), purpose: form.get("purpose"), status: form.get("status"), source: form.get("source"), evidence: form.get("evidence"), retentionUntil: form.get("retentionUntil") || null, quietStart: form.get("quietStart") || null, quietEnd: form.get("quietEnd") || null };
    const response = await fetch(`/api/contacts/${initial.id}/consents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setPending(false);
    if (!response.ok) {
      setConsentError(t("consent.saveFailed"));
      return;
    }
    await reload();
    setToast(t("consent.saved"));
    event.currentTarget.reset();
  };

  const updateDnc = async (enabled: boolean) => {
    if (enabled && !dncReason.trim()) return;
    setPending(true);
    setDncError("");
    const response = await fetch(`/api/contacts/${initial.id}/consents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "doNotContact", enabled, reason: enabled ? dncReason.trim() : "" }) });
    setPending(false);
    if (!response.ok) {
      setDncError(t("consent.saveFailed"));
      return;
    }
    setDncOpen(false);
    setDncReason("");
    await reload();
    setToast(t(enabled ? "consent.dncEnabled" : "consent.dncDisabled"));
  };

  const handleDnc = () => {
    if (data.doNotContact) void updateDnc(false);
    else setDncOpen(true);
  };

  return <div className="page-stack consent-page">
    <section className="page-heading-row">
      <div><p className="eyebrow">{t("consent.eyebrow")}</p><h1>{data.nameZh} / {data.nameEn}</h1><p>{t("consent.description")}</p></div>
      <div className="page-actions"><Link className="secondary-button" href="/people">{t("consent.back")}</Link><button className={data.doNotContact ? "secondary-button" : "danger-button"} type="button" disabled={pending} onClick={handleDnc}><Ban size={16} />{t(data.doNotContact ? "consent.removeDnc" : "consent.enableDnc")}</button></div>
    </section>
    {dncOpen && <form className="surface dnc-form" onSubmit={(event) => { event.preventDefault(); void updateDnc(true); }}>
      <label className="field"><span>{t("consent.dncReasonPrompt")}</span><textarea value={dncReason} onChange={(event) => setDncReason(event.target.value)} rows={3} maxLength={300} required autoFocus /></label>
      {dncError && <InlineMessage type="error">{dncError}</InlineMessage>}
      <div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => { setDncOpen(false); setDncError(""); }}>{t("common.cancel")}</button><button className="danger-button" disabled={pending || !dncReason.trim()}>{pending ? t("common.saving") : t("common.confirm")}</button></div>
    </form>}
    {!dncOpen && dncError && <InlineMessage type="error">{dncError}</InlineMessage>}
    {data.doNotContact && <InlineMessage type="warning">{t("consent.dncActive", { reason: data.doNotContactReason })}</InlineMessage>}
    <section className="consent-layout">
      <div className="surface consent-history">
        <div className="surface-heading"><div><p className="eyebrow">{t("consent.currentEyebrow")}</p><h2>{t("consent.current")}</h2></div><ShieldCheck size={21} /></div>
        {data.consents.map((item) => <article className="consent-row" key={item.id}><span className="consent-channel"><MailCheck size={17} />{t(`consent.channel.${item.channel.toLowerCase()}`)}</span><div><b>{t(`consent.purpose.${item.purpose.toLowerCase()}`)}</b><small>{t("consent.source")}: {item.source}</small><small>{item.retentionUntil ? t("consent.retainedUntil", { date: item.retentionUntil }) : t("consent.noExpiry")}</small></div><StatusBadge tone={item.status === "GRANTED" ? "green" : item.status === "REVOKED" ? "red" : "amber"}>{t(`consent.status.${item.status.toLowerCase()}`)}</StatusBadge></article>)}
        {!data.consents.length && <div className="empty-state"><span>{t("consent.empty")}</span></div>}
      </div>
      <form className="surface consent-form" onSubmit={save}>
        <div className="surface-heading"><div><p className="eyebrow">{t("consent.recordEyebrow")}</p><h2>{t("consent.record")}</h2></div><History size={21} /></div>
        <div className="form-grid two-column"><label className="field"><span>{t("consent.channel")}</span><select name="channel"><option value="EMAIL">{t("consent.channel.email")}</option><option value="SMS">{t("consent.channel.sms")}</option><option value="PHONE">{t("consent.channel.phone")}</option><option value="WECHAT">{t("consent.channel.wechat")}</option><option value="WHATSAPP">{t("consent.channel.whatsapp")}</option></select></label><label className="field"><span>{t("consent.purpose")}</span><select name="purpose"><option value="MARKETING">{t("consent.purpose.marketing")}</option><option value="SERVICE">{t("consent.purpose.service")}</option><option value="TRANSACTIONAL">{t("consent.purpose.transactional")}</option><option value="EVENT">{t("consent.purpose.event")}</option></select></label></div>
        <div className="form-grid two-column"><label className="field"><span>{t("consent.status")}</span><select name="status"><option value="GRANTED">{t("consent.status.granted")}</option><option value="REVOKED">{t("consent.status.revoked")}</option></select></label><label className="field"><span>{t("consent.source")}</span><input name="source" required maxLength={120} /></label></div>
        <label className="field"><span>{t("consent.evidence")}</span><textarea name="evidence" rows={3} /></label>
        <div className="form-grid three-column"><label className="field"><span>{t("consent.retention")}</span><input type="date" name="retentionUntil" /></label><label className="field"><span>{t("consent.quietStart")}</span><input type="time" name="quietStart" /></label><label className="field"><span>{t("consent.quietEnd")}</span><input type="time" name="quietEnd" /></label></div>
        {consentError && <InlineMessage type="error">{consentError}</InlineMessage>}
        <button className="primary-button" disabled={pending}><CheckCircle2 size={16} />{pending ? t("common.saving") : t("consent.save")}</button>
      </form>
    </section>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}
