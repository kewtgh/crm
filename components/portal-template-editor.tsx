"use client";
import { useRef,useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { portalTemplateContentSchema,type PortalTemplateContent,type SavedPortalTemplate } from "@/lib/portal-invitation-templates";
import type { EmailTemplateVisibility } from "@/lib/customer-email-templates";
import { useI18n } from "./i18n-provider";
import { useAppUser } from "./app-user-context";
import { AccessibleDrawer,InlineMessage } from "./ui";
export function PortalTemplateEditor({source,seed,onSaved,onClose}:{source?:SavedPortalTemplate;seed:PortalTemplateContent;onSaved:(item:SavedPortalTemplate)=>void;onClose:()=>void}){
  const {t}=useI18n(),user=useAppUser(),canPublish=["ADMIN","SUPER_ADMIN"].includes(user.role),copyOnly=source?.visibility==="WORKSPACE"&&!canPublish;
  const [name,setName]=useState(source?.name??""),[content,setContent]=useState(seed),[visibility,setVisibility]=useState<EmailTemplateVisibility>(copyOnly?"PERSONAL":source?.visibility??"PERSONAL"),[pending,setPending]=useState(false),[error,setError]=useState("");
  const busy=useRef(false),createId=useRef<string|null>(null);
  const save=async(asNew:boolean)=>{
    if(busy.current)return;
    const parsed=portalTemplateContentSchema.safeParse(content);
    if(!parsed.success||!name.trim()){setError(t("portalTemplates.invalid"));return;}
    busy.current=true;setPending(true);setError("");createId.current??=crypto.randomUUID();
    try{const data=await apiFetch<{item:SavedPortalTemplate}>("/api/portal/templates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:asNew?createId.current:source!.id,expectedRevision:asNew?null:source!.revision,name,visibility:asNew&&source?"PERSONAL":visibility,content:parsed.data})});onSaved(data.item);onClose();}
    catch(caught){setError(presentApiError(caught,t,"ux.templateSaveFailed").message);}finally{busy.current=false;setPending(false);}
  };
  return <AccessibleDrawer title={t("portalTemplates.edit")} description={t("portalTemplates.variables")} pending={pending} onClose={onClose}>
    <form className="page-stack" onSubmit={event=>{event.preventDefault();void save(!source||!!copyOnly);}}>
      <fieldset disabled={pending}>
        <label className="field"><span>{t("ux.templateName")}</span><input required maxLength={80} value={name} onChange={event=>setName(event.target.value)}/></label>
        <label className="field"><span>{t("ux.templateVisibility")}</span><select required disabled={!!source||!canPublish} value={visibility} onChange={event=>setVisibility(event.target.value as EmailTemplateVisibility)}><option value="PERSONAL">{t("ux.personalTemplates")}</option>{canPublish&&<option value="WORKSPACE">{t("ux.publicTemplates")}</option>}</select><small>{t("ux.templateScopeHelp")}</small></label>
        <label className="field"><span>{t("portalTemplates.validity")}</span><select required value={content.validityDays} onChange={event=>setContent(value=>({...value,validityDays:Number(event.target.value)}))}>{Array.from({length:30},(_,i)=>i+1).map(days=><option value={days} key={days}>{t("portalTemplates.days",{count:days})}</option>)}</select></label>
        <InlineMessage type="info">{t("ux.languagePair")}</InlineMessage>
        <div className="form-grid two-column">{(["Zh","En"] as const).map(language=><section className="page-stack" key={language}><h3>{language==="Zh"?"中文":"English"}</h3><label className="field"><span>{t("ux.subject")}</span><input maxLength={180} value={content[`subject${language}`]} onChange={event=>setContent(value=>({...value,[`subject${language}`]:event.target.value}))}/></label><label className="field"><span>{t("ux.body")}</span><textarea rows={10} maxLength={10000} value={content[`body${language}`]} onChange={event=>setContent(value=>({...value,[`body${language}`]:event.target.value}))}/></label></section>)}</div>
      </fieldset>
      {error&&<InlineMessage type="error">{error}</InlineMessage>}
      <div className="drawer-actions"><button type="button" className="secondary-button" disabled={pending} onClick={onClose}>{t("common.cancel")}</button>{source&&!copyOnly&&<button type="button" className="secondary-button" disabled={pending} onClick={()=>void save(true)}>{t("ux.saveAsNew")}</button>}<button className="primary-button" disabled={pending}>{t(copyOnly?"ux.saveAsPersonal":"common.save")}</button></div>
    </form>
  </AccessibleDrawer>;
}
