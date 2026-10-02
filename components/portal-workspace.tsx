"use client";
import { useRef,useState } from "react";
import { Copy,Link2,Plus,ShieldCheck,Trash2 } from "lucide-react";
import { AccessibleDrawer,ConfirmDialog,InlineMessage,StatusBadge,Toast } from "./ui";
import { useI18n } from "./i18n-provider";
import { useAppUser,useCapability } from "./app-user-context";
import { useUserPreferences } from "./user-preferences-context";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { renderPortalInvitation } from "@/lib/portal-invitation-templates";
import type { PortalInvitationRecord,PortalUpdateRecord } from "@/lib/v220-repository";
import { PortalInvitationDialog,type PortalInvitationDraft } from "./portal-invitation-dialog";

type Workspace={invitations:PortalInvitationRecord[];updates:PortalUpdateRecord[];invitationUrl?:string};
export function PortalWorkspace({initial}:{initial:Workspace}){
  const {locale,t}=useI18n(),user=useAppUser(),{formatDate}=useUserPreferences();
  const canDecide=useCapability("portal.decide"),canInvite=["SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER"].includes(user.role);
  const [data,setData]=useState(initial),[open,setOpen]=useState(false),[decision,setDecision]=useState<PortalUpdateRecord|null>(null),[revokeInvitation,setRevokeInvitation]=useState<PortalInvitationRecord|null>(null),[link,setLink]=useState(""),[pending,setPending]=useState(false),[error,setError]=useState(""),[toast,setToast]=useState("");
  const [message,setMessage]=useState<{subject:string;body:string;householdId:string;email:string}|null>(null),[query,setQuery]=useState(""),[status,setStatus]=useState(""),[family,setFamily]=useState("");
  const busy=useRef(false);
  const operate=async(body:Record<string,unknown>)=>{
    if(busy.current)return null;
    busy.current=true;setPending(true);setError("");
    try{const result=await apiFetch<Workspace>("/api/portal/invitations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});setData(result);if(result.invitationUrl)setLink(result.invitationUrl);return result;}
    catch(caught){setError(presentApiError(caught,t,"portal.failed").message);return null;}finally{busy.current=false;setPending(false);}
  };
  const create=async(draft:PortalInvitationDraft)=>{
    if(!canInvite)return;
    const {recipient,content,expiresAt}=draft;
    const result=await operate({operation:"create",householdId:recipient.household_id,email:recipient.email,expiresAt});
    if(!result?.invitationUrl)return;
    const rendered=renderPortalInvitation(content,draft.locale,{name:draft.locale==="en"?recipient.name_en||recipient.name_zh:recipient.name_zh||recipient.name_en,family:draft.locale==="en"?recipient.household_en||recipient.household_zh:recipient.household_zh||recipient.household_en,owner:user.displayName,portal_url:result.invitationUrl,expires:formatDate(expiresAt,{includeTime:true})});
    setMessage({...rendered,householdId:recipient.household_id,email:recipient.email});setOpen(false);setToast(t("portal.created"));
  };
  const decide=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(busy.current||!decision)return;
    const form=new FormData(event.currentTarget);
    if(await operate({operation:"decide",id:decision.id,status:form.get("status"),note:form.get("note")})){setDecision(null);setToast(t("portal.decided"));}
  };
  const revoke=async()=>{
    if(!revokeInvitation)return;
    if(await operate({operation:"revoke",id:revokeInvitation.id})){
      if(message?.householdId===revokeInvitation.householdId&&message.email.toLowerCase()===revokeInvitation.email.toLowerCase()){setLink("");setMessage(null);}
      setRevokeInvitation(null);setToast(t("portal.revoked"));
    }
  };
  const copy=async(text:string)=>{try{await navigator.clipboard.writeText(text);setToast(t("portal.copied"));}catch{setError(t("portalTemplates.copyFailed"));}};
  const familyOptions=[...new Map(data.invitations.map(item=>[item.householdId,locale==="en"?item.householdEn||item.householdZh:item.householdZh||item.householdEn])).entries()];
  const invitations=data.invitations.filter(item=>(!status||item.status===status)&&(!family||item.householdId===family)&&(!query.trim()||`${item.householdZh} ${item.householdEn} ${item.email}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
  return <div className="page-stack v220-workspace portal-workspace">
    <section className="page-heading-row"><div><p className="eyebrow">{t("portal.eyebrow")}</p><h1>{t("portal.title")}</h1><p>{t("portal.help")}</p></div><button className="primary-button" type="button" disabled={pending} onClick={()=>{setError("");setOpen(true);}}><Plus size={17}/>{t(canInvite?"portal.invite":"portalTemplates.openTemplates")}</button></section>
    <InlineMessage type="warning">{t("portal.security")}</InlineMessage>
    {!canInvite&&<InlineMessage type="info">{t("portalTemplates.roleHelp")}</InlineMessage>}
    {link&&<section className="surface page-stack portal-invitation-result"><InlineMessage type="success">{t("portal.linkOnce")}</InlineMessage><code className="one-time-link">{link}</code><div className="email-filter-actions"><button className="secondary-button" type="button" onClick={()=>void copy(link)}><Copy size={14}/>{t("common.copy")}</button></div>{message&&<><p>{t("portalTemplates.deliveryHelp")}</p><h3>{message.subject}</h3><pre className="email-preview">{message.body}</pre><button type="button" className="primary-button" onClick={()=>void copy(`${message.subject}\n\n${message.body}`)}><Copy size={16}/>{t("portalTemplates.copyMessage")}</button></>}</section>}
    {error&&!open&&!decision&&<InlineMessage type="error">{error}</InlineMessage>}
    <section className="surface"><div className="surface-heading"><div><h2>{t("portal.invitations")}</h2><p>{t("portal.invitationHelp")}</p></div><Link2 size={20}/></div>
      <div className="form-grid email-recipient-filters"><label className="field"><span>{t("common.search")}</span><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={t("portalTemplates.searchRecords")}/></label><label className="field"><span>{t("nav.households")}</span><select value={family} onChange={event=>setFamily(event.target.value)}><option value="">{t("ux.all")}</option>{familyOptions.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label><label className="field"><span>{t("common.status")}</span><select value={status} onChange={event=>setStatus(event.target.value)}><option value="">{t("ux.all")}</option>{["ACTIVE","REVOKED","EXPIRED"].map(value=><option value={value} key={value}>{t(`portalTemplates.status.${value}`)}</option>)}</select></label></div>
      <div className="v220-list">{invitations.map(item=><article key={item.id}><span className="product-icon"><ShieldCheck size={18}/></span><div><b>{locale==="zh-CN"?item.householdZh:item.householdEn}</b><small>{item.email} · {t("portal.expires",{date:formatDate(item.expiresAt,{dateOnly:true})})}</small><small>{item.lastAccessedAt?t("portal.lastAccess",{date:formatDate(item.lastAccessedAt,{includeTime:true})}):t("portal.neverAccessed")}</small></div><StatusBadge tone={item.status==="ACTIVE"?"green":"gray"}>{t(`portalTemplates.status.${item.status}`)}</StatusBadge>{canInvite&&item.status==="ACTIVE"&&<button className="text-button danger" type="button" disabled={pending} onClick={()=>setRevokeInvitation(item)}><Trash2 size={14}/>{t("portal.revoke")}</button>}</article>)}</div>
      {!invitations.length&&<div className="empty-state"><span>{t("common.noOptions")}</span></div>}
    </section>
    <section className="surface"><div className="surface-heading"><h2>{t("portal.updateRequests")}</h2></div><div className="v220-list">{data.updates.map(item=><article key={item.id}><div><b>{Object.keys(item.changes).map(key=>t(`portal.field.${key}`)).join(" · ")}</b><small>{JSON.stringify(item.changes)} · {formatDate(item.createdAt,{includeTime:true})}</small>{Object.keys(item.appliedChanges).length>0&&<small>{t("portal.appliedChanges")}: {JSON.stringify(item.appliedChanges)}</small>}</div><StatusBadge tone={item.status==="APPROVED"?"green":item.status==="REJECTED"?"red":"amber"}>{item.status}</StatusBadge>{canDecide&&item.status==="PENDING"&&<button className="secondary-button" type="button" disabled={pending} onClick={()=>setDecision(item)}>{t("portal.review")}</button>}</article>)}</div>{!data.updates.length&&<div className="empty-state"><span>{t("portal.noUpdates")}</span></div>}</section>
    {open&&<PortalInvitationDialog pending={pending} error={error} canCreate={canInvite} onClose={()=>setOpen(false)} onCreate={create}/>}
    {decision&&<AccessibleDrawer pending={pending} title={t("portal.review")} description={JSON.stringify(decision.changes)} onClose={()=>setDecision(null)}><form onSubmit={decide}><fieldset disabled={pending}><label className="field"><span>{t("common.status")}</span><select name="status" required><option value="APPROVED">{t("common.approve")}</option><option value="REJECTED">{t("common.reject")}</option></select></label><label className="field"><span>{t("portal.decisionNote")}</span><textarea name="note" minLength={3} rows={4} required/></label></fieldset>{error&&<InlineMessage type="error">{error}</InlineMessage>}<div className="drawer-actions"><button className="secondary-button" type="button" disabled={pending} onClick={()=>setDecision(null)}>{t("common.cancel")}</button><button className="primary-button" disabled={pending}>{pending?t("common.processing"):t("common.confirm")}</button></div></form></AccessibleDrawer>}
    {revokeInvitation&&<ConfirmDialog title={t("common.confirmAction")} description={t("portal.revokeConfirm",{email:revokeInvitation.email})} confirmLabel={t("portal.revoke")} pending={pending} onClose={()=>setRevokeInvitation(null)} onConfirm={()=>void revoke()}/>}
    {toast&&<Toast message={toast} onClose={()=>setToast("")}/>}
  </div>;
}
