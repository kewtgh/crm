"use client";
import { useRef,useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { customEmailSchema } from "@/lib/customer-email-input";
import { renderCustomerEmail,type CustomerEmailTemplate,type CustomEmailContent,type SavedEmailTemplate,type EmailTemplateVisibility } from "@/lib/customer-email-templates";
import { useI18n } from "./i18n-provider";
import { AccessibleDrawer,InlineMessage } from "./ui";
import { useAppUser } from "./app-user-context";
export function EmailTemplateEditor({template,source,onClose,onSaved}:{template:CustomerEmailTemplate;source?:SavedEmailTemplate;onClose:()=>void;onSaved:(item:SavedEmailTemplate)=>void}){
  const {t}=useI18n();
  const user=useAppUser(),canPublish=["ADMIN","SUPER_ADMIN"].includes(user.role);
  const copyOnly=source?.visibility==="WORKSPACE"&&!canPublish;
  const [visibility,setVisibility]=useState<EmailTemplateVisibility>(copyOnly?"PERSONAL":source?.visibility??"PERSONAL");
  const [name,setName]=useState(source?.name??""),[error,setError]=useState(""),[pending,setPending]=useState(false);
  const busy=useRef(false);
  const createId=useRef<string|null>(null);
  const [content,setContent]=useState<CustomEmailContent>(()=>{
    if(source)return{subjectZh:source.subjectZh,subjectEn:source.subjectEn,bodyZh:source.bodyZh,bodyEn:source.bodyEn,purpose:source.purpose};
    const preset=template==="CUSTOM"?"FOLLOW_UP":template,zh=renderCustomerEmail(preset,"zh-CN","{{name}}","{{owner}}"),en=renderCustomerEmail(preset,"en","{{name}}","{{owner}}");
    return{subjectZh:zh.subject,subjectEn:en.subject,bodyZh:zh.body,bodyEn:en.body,purpose:zh.purpose as CustomEmailContent["purpose"]};
  });
  const save=async(asNew:boolean)=>{
    if(busy.current)return;
    const parsed=customEmailSchema.safeParse(content);
    if(!parsed.success||!name.trim()){setError(t("ux.templateInvalid"));return;}
    busy.current=true;setPending(true);setError("");
    createId.current??=crypto.randomUUID();
    try{const data=await apiFetch<{item:SavedEmailTemplate}>("/api/customer-email/templates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name,content:parsed.data,id:!asNew&&source?source.id:createId.current,expectedRevision:!asNew&&source?source.revision:null,visibility:asNew&&source?"PERSONAL":visibility})});onSaved(data.item);onClose();}
    catch(caught){setError(presentApiError(caught,t,"ux.templateSaveFailed").message);}finally{busy.current=false;setPending(false);}
  };
  return <AccessibleDrawer title={t(copyOnly?"ux.copyTemplate":"ux.editTemplate")} description={t("ux.templateHelp")} pending={pending} onClose={onClose}>
    <form onSubmit={event=>{event.preventDefault();void save(!source||copyOnly);}} className="page-stack">
      <fieldset disabled={pending}>
        <label className="field"><span>{t("ux.templateName")} <span className="required-indicator">*</span></span><input required maxLength={80} value={name} onChange={event=>setName(event.target.value)}/></label>
        <label className="field"><span>{t("ux.templateVisibility")} <span className="required-indicator">*</span></span><select required disabled={!!source||!canPublish} value={visibility} onChange={event=>setVisibility(event.target.value as EmailTemplateVisibility)}><option value="PERSONAL">{t("ux.personalTemplates")}</option>{canPublish&&<option value="WORKSPACE">{t("ux.publicTemplates")}</option>}</select><small>{t("ux.templateScopeHelp")}</small></label>
        <label className="field"><span>{t("ux.purpose")} <span className="required-indicator">*</span></span><select required value={content.purpose} onChange={event=>setContent(old=>({...old,purpose:event.target.value as CustomEmailContent["purpose"]}))}><option value="SERVICE">{t("ux.service")}</option><option value="MARKETING">{t("ux.marketing")}</option></select></label>
        <InlineMessage type="info">{t("ux.languagePair")}</InlineMessage>
        <div className="form-grid two-column">{(["Zh","En"] as const).map(language=><section key={language} className="page-stack"><h3>{language==="Zh"?"中文":"English"}</h3><label className="field"><span>{t("ux.subject")}</span><input maxLength={180} value={content[`subject${language}`]} onChange={event=>setContent(old=>({...old,[`subject${language}`]:event.target.value}))}/></label><label className="field"><span>{t("ux.body")}</span><textarea rows={12} maxLength={10000} value={content[`body${language}`]} onChange={event=>setContent(old=>({...old,[`body${language}`]:event.target.value}))}/></label></section>)}</div>
      </fieldset>
      {error&&<InlineMessage type="error">{error}</InlineMessage>}
      <div className="drawer-actions"><button type="button" className="secondary-button" disabled={pending} onClick={onClose}>{t("common.cancel")}</button>{source&&!copyOnly&&<button type="button" className="secondary-button" disabled={pending} onClick={()=>void save(true)}>{t("ux.saveAsNew")}</button>}<button type="submit" className="primary-button" disabled={pending}>{t(copyOnly?"ux.saveAsPersonal":"common.save")}</button></div>
    </form>
  </AccessibleDrawer>;
}
