"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useState,useEffect} from "react";
import {UserRound, ShieldCheck, Clock3, Users, ChevronRight, Plus} from "lucide-react";
import {apiFetch} from "@/lib/api-client";
import type {ContactPrivacy} from "@/lib/phase2-repository";
import type {CustomerOperationsSnapshot} from "@/lib/customer-operations-repository";
import {useI18n} from "./i18n-provider";
import {useUserPreferences} from "./user-preferences-context";
import {RecordHeader,RecordIdentity} from "./record-header";
import {ResponsiveDetailLayout,SectionHeader} from "./responsive-detail-layout";
import {CustomerOperationsPanel} from "./customer-operations-panel";
import {ContactRecordAccess} from "./contact-record-access";
import {ContactConsentPage} from "./contact-consent-page";
import {CrmRecordEditor} from "./crm-record-editor";
import {RecordDeleteAction} from "./record-delete-action";
import {MoreActions} from "./more-actions";
import {UiIcon} from "./ui-icon";
import {InlineMessage,StatusBadge} from "./ui";

/** Owns presentation only. Record authorization and follow-up mutations stay with their existing owners. */
export function ContactWorkspace({initial}:{initial:ContactPrivacy}){
  const {t,enumLabel}=useI18n(),{formatDate}=useUserPreferences(),router=useRouter();
  const [data,setData]=useState(initial),[snapshot,setSnapshot]=useState<CustomerOperationsSnapshot|null>(null),[section,setSection]=useState("overview"),[recordEntry,setRecordEntry]=useState(0);
  const [refreshNotice,setRefreshNotice]=useState("");
  useEffect(()=>{const refresh=(event:Event)=>{const detail=(event as CustomEvent<{resource:string;id:string}>).detail;if(detail?.resource==="people"&&detail.id===initial.id)void apiFetch<ContactPrivacy>(`/api/contacts/${initial.id}/consents`).then(result=>{setData(result);setRefreshNotice("");}).catch(()=>setRefreshNotice(t("audit.savedRefreshFailed")));};window.addEventListener("lumina:crm-record-saved",refresh);return()=>window.removeEventListener("lumina:crm-record-saved",refresh);},[initial.id,t]);
  const missing=t("ux.record.notRecorded"),record=()=>{setSection("followUp");setRecordEntry(value=>value+1);};
  const organizationId=String(snapshot?.profile.organization_id||"");
  const overview=<ResponsiveDetailLayout context={<div className="workspace-rail">
    <section className="detail-section" data-surface-tone="context"><SectionHeader icon={<ShieldCheck size={18}/>} title={t("workspace.privacySummary")}/><dl className="workspace-status-list"><div><dt>{t("workspace.contactRestriction")}</dt><dd><StatusBadge tone={data.doNotContact?"red":"gray"}>{t(data.doNotContact?"workspace.contactBlocked":"workspace.contactAllowed")}</StatusBadge></dd></div>{data.consents.map(item=><div key={item.id}><dt>{enumLabel(`consent.channel.${item.channel.toLowerCase()}`).label} · {enumLabel(`consent.purpose.${item.purpose.toLowerCase()}`).label}</dt><dd><StatusBadge tone={item.status==="GRANTED"?"green":item.status==="REVOKED"?"red":"gray"}>{enumLabel(`consent.status.${item.status.toLowerCase()}`).label}</StatusBadge></dd></div>)}</dl>{!data.consents.length&&<p className="field-help">{t("workspace.noConsent")}</p>}<button className="text-button" onClick={()=>setSection("privacy")}>{t("workspace.consentDetail")} →</button></section>
    <section className="detail-section"><SectionHeader title={t("workspace.keyFacts")} help={t("workspace.visibleRecords")}/><dl className="workspace-facts"><div><dt>{t("customerOps.entries")}</dt><dd>{snapshot?.entryTotal??missing}</dd></div><div><dt>{t("nav.contracts")}</dt><dd>{snapshot?.contracts.length??missing}</dd></div></dl></section>
    <section className="detail-section"><SectionHeader title={t("workspace.quickActions")}/><div className="workspace-quick-links"><button className="text-button" onClick={()=>setSection("business")}>{t("ux.record.contractsProducts")} →</button><button className="text-button" onClick={()=>setSection("privacy")}>{t("workspace.consentDetail")} →</button>{organizationId&&<Link href={`/schools/${organizationId}`}>{t("detail.organizationLink")} →</Link>}</div></section>
  </div>}><div className="workspace-main-stack">
    <section className="detail-section"><SectionHeader icon={<UserRound size={18}/>} title={t("workspace.contactProfile")} action={snapshot?.canManage&&<CrmRecordEditor resource="people" id={data.id}/>}/><dl className="workspace-info-grid">{[
      ["contact.type",enumLabel(`contact.type.${data.contactType.toLowerCase()}`).label],["customerOps.field.title",data.title],["contact.decisionRole",enumLabel(`contact.decisionRole.${data.decisionRole.toLowerCase()}`).label],
      ["contact.preferredLanguage",data.preferredLanguage],["contact.preferredContactMethod",enumLabel(`contact.method.${data.preferredContactMethod.toLowerCase()}`).label],
      ["modules.phone",data.phone],["modules.email",data.email],["contact.acquisitionSource",data.acquisitionSource],["contact.nextFollowUp",data.nextFollowUpAt?formatDate(data.nextFollowUpAt,{includeTime:true}):missing],
    ].map(([label,value])=><div key={label}><dt>{t(label)}</dt><dd>{value||missing}</dd></div>)}</dl></section>
    <section className="detail-section" data-surface-tone="context"><SectionHeader icon={<Users size={18}/>} title={t("workspace.relationships")}/>{data.households.map(h=><div className="workspace-related-row" key={h.id}><Link href={`/households?tab=families&focus=${h.id}`}><RecordIdentity nameZh={h.nameZh} nameEn={h.nameEn}/></Link><small>{enumLabel(`education.memberRole.${h.role.toLowerCase()}`).label}{h.primary?` · ${t("education.primaryContact")}`:""}</small></div>)}{!data.households.length&&<div className="workspace-empty"><Users size={24}/><b>{t("contact.noHouseholds")}</b></div>}</section>
    <section className="detail-section"><SectionHeader icon={<Clock3 size={18}/>} title={t("workspace.recentActivity")} action={snapshot?.canManage&&<button className="secondary-button" onClick={record}>{t("customerOps.record")}</button>}/><div className="workspace-activity-list">{snapshot?.entries.slice(0,3).map(entry=><article key={entry.id}><time>{formatDate(entry.occurred_at,{includeTime:true})}</time><div><b>{enumLabel(`activity.kind.${entry.kind}`).label}</b><p>{entry.summary}</p><small>{t("ux.record.nextAction")}: {entry.next_step||missing}</small></div></article>)}</div>{snapshot&&!snapshot.entries.length&&<p className="field-help">{t("workspace.noActivity")}</p>}</section>
  </div></ResponsiveDetailLayout>;
  return <div className="page-stack contact-workspace"><RecordHeader nameZh={data.nameZh} nameEn={data.nameEn} avatar={<UserRound size={30}/>} breadcrumb={<><Link href="/people">{t("nav.people")}</Link><ChevronRight size={13}/><span>{t("workspace.contactProfile")}</span></>}
    status={<StatusBadge tone="blue">{enumLabel(`contact.type.${data.contactType.toLowerCase()}`).label}</StatusBadge>}
    context={<>{organizationId&&<Link className="ux-icon-label" href={`/schools/${organizationId}`}><UiIcon name="organization" size={16}/>{t("detail.organizationLink")}</Link>}<span className="ux-icon-label"><UiIcon name="person" size={16}/>{t("crm.owner")}: {data.ownerName||missing}</span><span className="ux-icon-label"><UiIcon name="activity" size={16}/>{enumLabel(`contact.communication.level${data.communicationLevel}`).label}</span></>}
    primaryAction={snapshot?.canManage&&<button className="primary-button" onClick={record}><Plus size={16}/>{t("customerOps.record")}</button>}
    secondaryActions={snapshot?.canManage&&<CrmRecordEditor resource="people" id={data.id} onSaved={item=>setData(current=>({...current,nameZh:item.nameZh,nameEn:item.nameEn,title:item.title??"",phone:item.phone??"",email:item.email??"",ownerName:item.ownerName,nextFollowUpAt:item.nextFollowUpAt??null}))}/>}
    moreActions={snapshot?.canManage&&<MoreActions label={t("ui.moreActionsFor",{name:data.nameZh||data.nameEn})}><div className="ux-mobile-actions"><CrmRecordEditor menuItem resource="people" id={data.id}/></div><RecordDeleteAction menuItem kind="CONTACT" id={data.id} label={data.nameZh||data.nameEn} onDeleted={()=>router.push("/people")}/></MoreActions>}/>
    {refreshNotice&&<InlineMessage type="info">{refreshNotice}</InlineMessage>}
    <CustomerOperationsPanel subject="CONTACT" id={data.id} hideIdentity overview={overview} activeSection={section} onSectionChange={setSection} recordEntryRequested={recordEntry} onSnapshot={setSnapshot} extra={<><ContactRecordAccess id={data.id} ownerName={data.ownerName}/><ContactConsentPage key={`${data.nameZh}:${data.nameEn}`} initial={data} onDataChange={setData} embedded/></>}/>
  </div>;
}
