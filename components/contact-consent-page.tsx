"use client";
import { DateInput } from "@/components/structured-inputs";

import Link from "next/link";
import {useReceiptMutation} from "@/hooks/use-receipt-mutation";
import { useState } from "react";
import { Ban, CheckCircle2, History, MailCheck, ShieldCheck } from "lucide-react";
import type { ContactPrivacy } from "@/lib/phase2-repository";
import { useI18n } from "./i18n-provider";
import { InlineMessage, StatusBadge, Toast } from "./ui";
import { apiFetch } from "@/lib/api-client";
import { CrmRecordEditor } from "@/components/crm-record-editor";
import { MarkdownContent } from "@/components/markdown-content";
import { useUserPreferences } from "./user-preferences-context";

export function ContactConsentPage({ initial, embedded=false, onDataChange }: { initial: ContactPrivacy; embedded?:boolean; onDataChange?:(data:ContactPrivacy)=>void }) {
  const { t,locale } = useI18n();
  const mutation=useReceiptMutation(`/api/contacts/${initial.id}/consents`);
  const [preview,setPreview]=useState({channel:"EMAIL",purpose:"MARKETING",status:"GRANTED"});
  const { formatDate } = useUserPreferences();
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [dncError, setDncError] = useState("");
  const [dncOpen, setDncOpen] = useState(false);
  const [dncReason, setDncReason] = useState("");
  const [toast, setToast] = useState("");
  const [accepted,setAccepted]=useState(false);

  const reload = async () => {
    try{const updated=await apiFetch<ContactPrivacy>(`/api/contacts/${initial.id}/consents`);setData(updated);onDataChange?.(updated);setAccepted(false);setConsentError("");}catch(caught){void caught;setConsentError(t("audit.savedRefreshFailed"));}
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if(accepted){await reload();return;}
    setPending(true);
    setConsentError("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = { operation: "consent", channel: form.get("channel"), purpose: form.get("purpose"), status: form.get("status"), source: form.get("source"), evidence: form.get("evidence"), retentionUntil: form.get("retentionUntil") || null, quietStart: form.get("quietStart") || null, quietEnd: form.get("quietEnd") || null };
    const saved=await mutation.send(body);
    if(!saved){setPending(false);return;}
    setAccepted(true);setPending(false);
    await reload();
    setToast(t("consent.saved"));
    formElement.reset();
  };

  const updateDnc = async (enabled: boolean) => {
    if (enabled && !dncReason.trim()) return;
    setPending(true);
    setDncError("");
    const saved=await mutation.send({operation:"doNotContact",enabled,reason:enabled?dncReason.trim():""});
    if(!saved){setPending(false);return;}
    setAccepted(true);setPending(false);
    setDncOpen(false);
    setDncReason("");
    await reload();
    setToast(t(enabled ? "consent.dncEnabled" : "consent.dncDisabled"));
  };

  const handleDnc = () => {
    if(accepted){void reload();return;}
    if (data.doNotContact) void updateDnc(false);
    else setDncOpen(true);
  };

  return <div className="page-stack consent-page">
    {!embedded&&<section className="page-heading-row">
      <div><p className="eyebrow">{t("consent.eyebrow")}</p><h1>{data.nameZh} / {data.nameEn}</h1><p>{t("consent.description")}</p></div>
      <div className="page-actions"><Link className="secondary-button" href="/people">{t("consent.back")}</Link>{data.canManageConsent&&<CrmRecordEditor resource="people" id={initial.id} onSaved={item=>setData(current=>({...current,nameZh:item.nameZh,nameEn:item.nameEn,email:item.email??"",phone:item.phone??"",title:item.title??"",contactType:item.contactType??"CONTACT",recordStatus:item.status,contactStatus:item.contactStatus??"NEW",communicationLevel:item.communicationLevel??1,notesMarkdown:item.notesMarkdown??"",ownerId:item.ownerId??null,ownerName:item.ownerName,preferredContactMethod:item.preferredContactMethod??"EMAIL",preferredLanguage:item.preferredLanguage??"",acquisitionSource:item.acquisitionSource??"",decisionRole:item.decisionRole??"UNKNOWN",tags:item.tags??[],nextFollowUpAt:item.nextFollowUpAt??null,households:item.households??current.households}))}/>} {data.canManageConsent&&<button className={data.doNotContact ? "secondary-button" : "danger-button"} type="button" disabled={pending} onClick={handleDnc}><Ban size={16} />{t(data.doNotContact ? "consent.removeDnc" : "consent.enableDnc")}</button>}</div>
    </section>}
    {embedded&&data.canManageConsent&&<div className="ux-section-actions"><button className="secondary-button" type="button" disabled={pending} onClick={handleDnc}>{t(data.doNotContact?"consent.removeDnc":"consent.enableDnc")}</button></div>}
    {dncOpen && <form className="surface dnc-form" onSubmit={(event) => { event.preventDefault(); void updateDnc(true); }}>
      <label className="field"><span>{t("consent.dncReasonPrompt")}</span><textarea value={dncReason} onChange={(event) => setDncReason(event.target.value)} rows={3} maxLength={300} required autoFocus /></label>
      {dncError && <InlineMessage type="error">{dncError}</InlineMessage>}
      <div className="drawer-actions"><button className="secondary-button" type="button" onClick={() => { setDncOpen(false); setDncError(""); }}>{t("common.cancel")}</button><button className="danger-button" disabled={pending || !dncReason.trim()}>{pending ? t("common.saving") : t("common.confirm")}</button></div>
    </form>}
    {!dncOpen && dncError && <InlineMessage type="error">{dncError}</InlineMessage>}
    {accepted&&<InlineMessage type="info">{t("audit.savedRefreshFailed")}<button className="text-button" onClick={()=>void reload()}>{t("ux.management.refresh")}</button></InlineMessage>}
    {data.doNotContact && <InlineMessage type="warning">{t("consent.dncActive", { reason: data.doNotContactReason })}</InlineMessage>}
    {!embedded&&<section className="contact-profile-grid"><article className="surface contact-operating-profile"><div className="surface-heading"><div><p className="eyebrow">{t("contact.profileEyebrow")}</p><h2>{t("contact.profile")}</h2></div><StatusBadge tone={data.contactStatus==="CONNECTED"?"green":data.contactStatus==="DORMANT"?"red":"amber"}>{t(`contact.status.${data.contactStatus.toLowerCase()}`)}</StatusBadge></div><dl><div><dt>{t("contact.type")}</dt><dd>{t(`contact.type.${data.contactType.toLowerCase()}`)}</dd></div><div><dt>{t("contact.communicationLevel")}</dt><dd>{t(`contact.communication.level${data.communicationLevel}`)}</dd></div><div><dt>{t("crm.owner")}</dt><dd>{data.ownerName}</dd></div><div><dt>{t("contact.decisionRole")}</dt><dd>{t(`contact.decisionRole.${data.decisionRole.toLowerCase()}`)}</dd></div><div><dt>{t("contact.preferredContactMethod")}</dt><dd>{t(`contact.method.${data.preferredContactMethod.toLowerCase()}`)}</dd></div><div><dt>{t("contact.preferredLanguage")}</dt><dd>{data.preferredLanguage||"—"}</dd></div><div><dt>{t("contact.acquisitionSource")}</dt><dd>{data.acquisitionSource||"—"}</dd></div><div><dt>{t("contact.nextFollowUp")}</dt><dd>{data.nextFollowUpAt?formatDate(data.nextFollowUpAt,{includeTime:true}):"—"}</dd></div><div><dt>{t("modules.email")}</dt><dd>{data.email||"—"}</dd></div><div><dt>{t("modules.phone")}</dt><dd>{data.phone||"—"}</dd></div></dl><div className="contact-tags">{data.tags.map(tag=><span key={tag}>{tag}</span>)}{!data.tags.length&&<small>{t("contact.noTags")}</small>}</div></article><article className="surface"><div className="surface-heading"><div><p className="eyebrow">{t("contact.familyEyebrow")}</p><h2>{t("contact.households")}</h2></div></div>{data.households.map(household=><p className="contact-household" key={household.id}><b>{household.nameZh} / {household.nameEn}</b><small>{t(`education.memberRole.${household.role.toLowerCase()}`)}{household.primary?` · ${t("education.primaryContact")}`:""}</small></p>)}{!data.households.length&&<p className="select-empty">{t("contact.noHouseholds")}</p>}</article><article className="surface contact-notes"><div className="surface-heading"><div><p className="eyebrow">{t("contact.notesEyebrow")}</p><h2>{t("contact.notes")}</h2></div></div><MarkdownContent value={data.notesMarkdown} empty={t("contact.notesEmpty")}/></article></section>}
    <section className="consent-layout">
      <div className="surface consent-history">
        <div className="surface-heading"><div><p className="eyebrow">{t("consent.currentEyebrow")}</p><h2>{t("consent.current")}</h2></div><ShieldCheck size={21} /></div>
        {data.consents.map((item) => <article className="consent-row" key={item.id}><span className="consent-channel"><MailCheck size={17} />{t(`consent.channel.${item.channel.toLowerCase()}`)}</span><div><b>{t(`consent.purpose.${item.purpose.toLowerCase()}`)}</b><small>{t("consent.source")}: {item.source}</small><small>{item.retentionUntil ? t("consent.retainedUntil", { date: item.retentionUntil }) : t("consent.noExpiry")}</small></div><StatusBadge tone={item.status === "GRANTED" ? "green" : item.status === "REVOKED" ? "red" : "amber"}>{t(`consent.status.${item.status.toLowerCase()}`)}</StatusBadge></article>)}
        {!data.consents.length && <div className="empty-state"><span>{t("consent.empty")}</span></div>}
      </div>
      {data.canManageConsent&&<form className="surface consent-form" onSubmit={save}><fieldset className="follow-up-fields" disabled={pending||mutation.uncertain||accepted}>
        <div className="surface-heading"><div><p className="eyebrow">{t("consent.recordEyebrow")}</p><h2>{locale==="en"?"Record a communication consent change":"记录一次通信授权变更"}</h2></div><History size={21} /></div>
        <div className="form-grid two-column"><label className="field"><span>{t("consent.channel")}</span><select name="channel" required value={preview.channel} onChange={e=>setPreview({...preview,channel:e.target.value})}><option value="EMAIL">{t("consent.channel.email")}</option><option value="SMS">{t("consent.channel.sms")}</option><option value="PHONE">{t("consent.channel.phone")}</option><option value="WECHAT">{t("consent.channel.wechat")}</option><option value="WHATSAPP">{t("consent.channel.whatsapp")}</option></select></label><label className="field"><span>{t("consent.purpose")}</span><select name="purpose" required value={preview.purpose} onChange={e=>setPreview({...preview,purpose:e.target.value})}><option value="MARKETING">{t("consent.purpose.marketing")}</option><option value="SERVICE">{t("consent.purpose.service")}</option><option value="TRANSACTIONAL">{t("consent.purpose.transactional")}</option><option value="EVENT">{t("consent.purpose.event")}</option></select></label></div>
        <div className="form-grid two-column"><label className="field"><span>{t("consent.status")}</span><select name="status" required value={preview.status} onChange={e=>setPreview({...preview,status:e.target.value})}><option value="GRANTED">{t("consent.status.granted")}</option><option value="REVOKED">{t("consent.status.revoked")}</option></select></label><label className="field"><span>{t("consent.source")}</span><input name="source" required maxLength={120} /></label></div>
        <label className="field"><span>{t("consent.evidence")}</span><textarea name="evidence" rows={3} /></label>
        <div className="form-grid three-column"><label className="field"><span>{t("consent.retention")}</span><DateInput type="date" name="retentionUntil" /></label><label className="field"><span>{t("consent.quietStart")}</span><DateInput type="time" name="quietStart" /></label><label className="field"><span>{t("consent.quietEnd")}</span><DateInput type="time" name="quietEnd" /></label></div>
        <p role="status">{locale==="en"?"Record":"记录"} · {t(`consent.status.${preview.status.toLowerCase()}`)} · {t(`consent.channel.${preview.channel.toLowerCase()}`)} · {t(`consent.purpose.${preview.purpose.toLowerCase()}`)}. {locale==="en"?"Effective when saved; does not change record access.":"保存时生效；不会改变档案访问权限。"}</p></fieldset>
        {mutation.error&&<InlineMessage type="error">{mutation.error}</InlineMessage>}
        {consentError && <InlineMessage type="error">{consentError}</InlineMessage>}
        <button className="primary-button" disabled={pending}><CheckCircle2 size={16} />{t(pending?"common.saving":accepted?"ux.management.refresh":mutation.uncertain?"enrollments.retry":"consent.save")}</button>
      </form>}
    </section>
    <section className="detail-section"><h2>{locale==="en"?"Communication change history":"通信同意变更历史"}</h2><p className="field-help">{locale==="en"?"Changes recorded since this history was enabled. Earlier current permissions are shown above.":"此处展示启用变更历史后的记录；此前的当前权限显示在上方。"}</p>{data.consentHistory?.map(item=><article className="consent-row" key={item.id}><b>{t(`consent.channel.${item.channel.toLowerCase()}`)} · {t(`consent.purpose.${item.purpose.toLowerCase()}`)}</b><span>{t(`consent.status.${item.status.toLowerCase()}`)}</span><small>{item.source} · {formatDate(item.effective_at,{includeTime:true})}</small><small>{item.recorded_by} · {formatDate(item.recorded_at,{includeTime:true})}</small></article>)}</section>
    {toast && <Toast message={toast} onClose={() => setToast("")} />}
  </div>;
}
