"use client";
import Link from "next/link";
import {SectionHeader} from "./responsive-detail-layout";
import {UiIcon} from "./ui-icon";
import {useCallback,useEffect,useRef,useState} from "react";
import {isDefinitiveMutationFailure,settleMutation} from "@/lib/mutation-outcome";
import {apiFetch} from "@/lib/api-client";
import type {getChannelActivation} from "@/lib/channel-activation-repository";
import {partnershipStages} from "@/lib/lead-pool-input";
import {useI18n} from "./i18n-provider";
import {useCapability} from "./app-user-context";
import {useUserPreferences} from "./user-preferences-context";
import {AccessibleDrawer,InlineMessage} from "./ui";
function activationResponse(result:Awaited<ReturnType<typeof getChannelActivation>>) {
 const p=result?.projection;
 const counts=["openLeadCount","claimedLeadCount","keyContactCount","decisionMakerCount","activeOpportunityCount","recentRecruitmentEventCount","primaryEnrollmentCount","assistEnrollmentCount"] as const;
 if(!p||typeof p.organizationId!=="string"||!Array.isArray(result.history)||!counts.every(key=>typeof p[key]==="number"&&Number.isInteger(p[key])&&p[key]>=0))throw new Error("RECORD_RESPONSE_INVALID");
 return result;
}
export function ChannelActivationPanel({organizationId,onSaved,compact=false}:{organizationId:string;onSaved?:()=>Promise<unknown>;compact?:boolean}){
 const {t,enumLabel}=useI18n(),{formatDate}=useUserPreferences(),manage=useCapability("education.manage");
 const [data,setData]=useState<Awaited<ReturnType<typeof getChannelActivation>>|null>(null),[error,setError]=useState(""),[open,setOpen]=useState(false),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false);
 const attempt=useRef<unknown>(null),busy=useRef(false);
 const load=useCallback(async(propagate=false)=>{try{const result=await apiFetch<Awaited<ReturnType<typeof getChannelActivation>>>(`/api/organizations/${organizationId}/activation`);setData(activationResponse(result));setError("");}catch(error){setError(t("pool.loadFailed"));if(propagate)throw error;}},[organizationId,t]);
 useEffect(()=>{const controller=new AbortController();void apiFetch<Awaited<ReturnType<typeof getChannelActivation>>>(`/api/organizations/${organizationId}/activation`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setData(activationResponse(result));setError("");}}).catch(()=>{if(!controller.signal.aborted)setError(t("pool.loadFailed"));});return()=>controller.abort();},[organizationId,t]);
 const save=async(event?:React.FormEvent<HTMLFormElement>)=>{
 event?.preventDefault();if(busy.current||!data)return;
 if(!attempt.current&&event){const form=new FormData(event.currentTarget);attempt.current={stage:form.get("stage"),reason:form.get("reason"),expectedRevision:data.projection.profileRevision,requestKey:crypto.randomUUID()};}
 if(!attempt.current)return;busy.current=true;setPending(true);
 const request=attempt.current;
 const outcome=await settleMutation(async()=>{
  await apiFetch(`/api/organizations/${organizationId}/activation`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)});
  attempt.current=null;setUncertain(false);setOpen(false);
 },async()=>{await load(true);await onSaved?.();});
 if(outcome.state==="failed"){
  const caught=outcome.error;
  if(isDefinitiveMutationFailure(caught)){attempt.current=null;setUncertain(false);setError(t(caught.code.includes("VERSION_CONFLICT")?"pool.conflict":"pool.forbidden"));}
  else{setUncertain(true);setError(t("pool.uncertain"));}
 }else if(outcome.state==="saved-refresh-failed")setError(t("audit.savedRefreshFailed"));
 busy.current=false;setPending(false);
 };

 if(!data)return <InlineMessage type={error?"error":"info"}>{error||t("common.loading")}</InlineMessage>;
 const p=data.projection;
 const metrics:[string,string,string][]=[["openLeadCount","LEAD","lead"],["claimedLeadCount","LEAD","assignment"],["keyContactCount","CONTACT","keyPeople"],["decisionMakerCount","CONTACT","decisionMakers"],["activeOpportunityCount","OPPORTUNITY","opportunity"],["recentRecruitmentEventCount","EVENT","events"],["primaryEnrollmentCount","ATTRIBUTION","primary"],["assistEnrollmentCount","ATTRIBUTION","assist"]];
 return <section className={`detail-section${compact?" workspace-activation":""}`}><SectionHeader icon={<UiIcon name="channel"/>} title={t(compact?"workspace.cooperation":"pool.activation")} action={manage&&p.canManage&&p.profileRevision&&<button className="secondary-button" onClick={()=>{setOpen(true);setError("");}}>{t("pool.updateStage")}</button>}/>{error&&!open&&<InlineMessage type="error">{error}<button type="button" className="text-button" disabled={pending} onClick={()=>void load()}>{t("reliability.refreshOnly")}</button></InlineMessage>}<dl className="customer-profile"><div><dt>{t("pool.stage")}</dt><dd>{p.currentPartnershipStage?enumLabel(`business.option.${p.currentPartnershipStage}`).label:t("ux.record.notRecorded")}</dd><small>{t("pool.source.PROFILE")}</small></div><div><dt>{t("pool.stageSince")}</dt><dd>{p.stageChangedAt?formatDate(p.stageChangedAt,{includeTime:true}):t("channel.unknown")}</dd></div></dl><h3 className="ux-icon-label"><UiIcon name="metric"/>{t("workspace.channelProgress")}</h3><dl className="workspace-channel-facts">{metrics.filter(([key])=>!compact||["openLeadCount","claimedLeadCount","keyContactCount","activeOpportunityCount"].includes(key)).map(([key,source,label])=><div key={key}><dt>{t(`pool.${label}`)}</dt><dd>{String(p[key as keyof typeof p])}</dd><small>{t(`pool.source.${source}`)}</small></div>)}</dl>{compact&&<details className="workspace-secondary-disclosure"><summary>{t("workspace.moreDetails")}</summary><dl className="workspace-channel-facts">{metrics.filter(([key])=>!["openLeadCount","claimedLeadCount","keyContactCount","activeOpportunityCount"].includes(key)).map(([key,source,label])=><div key={key}><dt>{t(`pool.${label}`)}</dt><dd>{String(p[key as keyof typeof p])}</dd><small>{t(`pool.source.${source}`)}</small></div>)}</dl></details>}<p>{t("business.field.next_action")}: {p.nextAction||t("ux.record.notRecorded")}</p><details className="workspace-secondary-disclosure"><summary>{t("pool.stageHistory")}</summary><div className="page-actions"><Link href={`/leads?organization=${organizationId}`}>{t("pool.lead")}</Link><Link href={`/opportunities`}>{t("pool.opportunity")}</Link><Link href="/education-business?resource=events">{t("pool.events")}</Link><Link href="/enrollments">{t("pool.primary")}</Link></div><div className="detail-record-list">{p.leads.map(l=><article key={l.id}><Link href={`/leads?focus=${l.id}`}>{t(`leads.status.${l.status.toLowerCase()}`)}</Link><span>{l.owner_id||t("pool.unassigned")}</span></article>)}{p.events.map(e=><article key={e.id}><Link href={`/education-business?resource=events&focus=${e.id}`}>{e.name}</Link><span>{formatDate(e.starts_on,{dateOnly:true})}</span></article>)}</div><h4>{t("pool.stageHistory")}</h4><div className="detail-record-list">{data.history.map(h=><article key={h.id}><div>{h.from_stage?t(`business.option.${h.from_stage}`):"—"} → {t(`business.option.${h.to_stage}`)}<p>{h.reason}</p><small>{formatDate(h.changed_at,{includeTime:true})}</small></div></article>)}</div>{!data.history.length&&<p>{t("pool.noHistory")}</p>}</details>
 {open&&<AccessibleDrawer title={t("pool.updateStage")} pending={pending||uncertain} onClose={()=>setOpen(false)}><form onSubmit={e=>void save(e)}><fieldset className="follow-up-fields" disabled={pending||uncertain}><label className="field"><span>{t("pool.stage")}</span><select name="stage" defaultValue={p.currentPartnershipStage??"PROSPECT"}>{partnershipStages.map(stage=><option key={stage} value={stage}>{t(`business.option.${stage}`)}</option>)}</select></label><label className="field"><span>{t("pool.reason")}</span><textarea name="reason" maxLength={1000} required/></label></fieldset>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button type="button" className="secondary-button" disabled={pending||uncertain} onClick={()=>setOpen(false)}>{t("common.cancel")}</button><button className="primary-button" type={uncertain?"button":"submit"} disabled={pending} onClick={uncertain?()=>void save():undefined}>{t(uncertain?"business.retrySame":"common.save")}</button></div></form></AccessibleDrawer>}
 </section>;
}
