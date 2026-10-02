"use client";
import { useEffect,useRef,useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { presentApiError } from "@/lib/api-error-presenter";
import { PORTAL_INVITATION_PRESETS,portalTemplateContentSchema,type PortalTemplateContent,type SavedPortalTemplate } from "@/lib/portal-invitation-templates";
import { useI18n } from "./i18n-provider";
import { useAppUser } from "./app-user-context";
import { useUserPreferences } from "./user-preferences-context";
import { AccessibleDrawer,ConfirmDialog,InlineMessage } from "./ui";
import { DateInput } from "./structured-inputs";
import { PortalRecipientPicker,type PortalRecipient } from "./portal-recipient-picker";
import { PortalTemplateEditor } from "./portal-template-editor";
export type PortalInvitationDraft={recipient:PortalRecipient;content:PortalTemplateContent;locale:"zh-CN"|"en";expiresAt:string};
export function PortalInvitationDialog({pending,error,canCreate,onCreate,onClose}:{pending:boolean;error:string;canCreate:boolean;onCreate:(draft:PortalInvitationDraft)=>Promise<void>;onClose:()=>void}){
  const {t,locale}=useI18n(),user=useAppUser(),canPublish=["ADMIN","SUPER_ADMIN"].includes(user.role),{localDateTimeInput,localDateTimeToIso}=useUserPreferences();
  const [recipient,setRecipient]=useState<PortalRecipient|null>(null),[language,setLanguage]=useState(locale),[choice,setChoice]=useState("preset:WELCOME"),[templates,setTemplates]=useState<SavedPortalTemplate[]>([]),[editor,setEditor]=useState(false),[templateError,setTemplateError]=useState(""),[attempt,setAttempt]=useState(0),[formError,setFormError]=useState("");
  const [content,setContent]=useState<PortalTemplateContent>(PORTAL_INVITATION_PRESETS.WELCOME),[expires,setExpires]=useState(()=>localDateTimeInput(Date.now()+7*86400000));
  const [archiveTarget,setArchiveTarget]=useState<SavedPortalTemplate|null>(null),[archivePending,setArchivePending]=useState(false),[archiveError,setArchiveError]=useState("");
  const busy=useRef(false);
  const source=templates.find(item=>`saved:${item.id}`===choice),canManage=!!source&&(source.visibility==="PERSONAL"||canPublish);
  useEffect(()=>{
    const controller=new AbortController();void apiFetch<{items:SavedPortalTemplate[]}>("/api/portal/templates",{signal:controller.signal}).then(data=>{if(!controller.signal.aborted){setTemplates(data.items);setTemplateError("");}}).catch(caught=>{if(!controller.signal.aborted)setTemplateError(presentApiError(caught,t,"ux.templateLoadFailed").message);});return()=>controller.abort();
  },[attempt,t]);
  const apply=(next:PortalTemplateContent)=>{
    setContent({subjectZh:next.subjectZh||next.subjectEn,subjectEn:next.subjectEn||next.subjectZh,bodyZh:next.bodyZh||next.bodyEn,bodyEn:next.bodyEn||next.bodyZh,purpose:"SERVICE",validityDays:next.validityDays});
    setExpires(localDateTimeInput(Date.now()+next.validityDays*86400000));setFormError("");
  };
  const submit=async(event:React.FormEvent<HTMLFormElement>)=>{
    event.preventDefault();if(busy.current||pending||!canCreate)return;
    const parsed=portalTemplateContentSchema.safeParse(content);
    if(!recipient){setFormError(t("portal.householdRequired"));return;}
    if(!parsed.success){setFormError(t("portalTemplates.invalid"));return;}
    let expiresAt:string;
    try{expiresAt=localDateTimeToIso(expires);const remaining=Date.parse(expiresAt)-Date.now();if(remaining<=300000||remaining>30*86400000)throw new Error("INVALID_EXPIRY");}
    catch{setFormError(t("portalTemplates.invalidExpiry"));return;}
    busy.current=true;setFormError("");
    try{await onCreate({recipient:{...recipient},content:structuredClone(parsed.data),locale:language,expiresAt});}finally{busy.current=false;}
  };
  const archive=async()=>{
    if(busy.current||pending||!archiveTarget)return;
    busy.current=true;setArchivePending(true);setArchiveError("");
    try{await apiFetch("/api/portal/templates",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({operation:"archive",id:archiveTarget.id,expectedRevision:archiveTarget.revision})});setTemplates(items=>items.filter(item=>item.id!==archiveTarget.id));setChoice("preset:WELCOME");apply(PORTAL_INVITATION_PRESETS.WELCOME);setArchiveTarget(null);}
    catch(caught){setArchiveError(presentApiError(caught,t,"ux.templateArchiveFailed").message);}finally{busy.current=false;setArchivePending(false);}
  };
  if(editor)return <PortalTemplateEditor seed={content} source={source} onClose={()=>setEditor(false)} onSaved={item=>{setTemplates(items=>[...items.filter(value=>value.id!==item.id),item]);setChoice(`saved:${item.id}`);apply(item);}}/>;
  return <AccessibleDrawer pending={pending||archivePending} title={t("portal.invite")} description={t("portalTemplates.createHelp")} onClose={onClose}>
    <form className="page-stack" onSubmit={submit}>
      {!canCreate&&<InlineMessage type="info">{t("portalTemplates.roleHelp")}</InlineMessage>}
      <fieldset disabled={pending||archivePending}>
        <label className="field"><span>{t("portalTemplates.template")}</span><select required value={choice} onChange={event=>{const value=event.target.value,next=value.startsWith("preset:")?PORTAL_INVITATION_PRESETS[value.slice(7) as keyof typeof PORTAL_INVITATION_PRESETS]:templates.find(item=>`saved:${item.id}`===value);if(next){setChoice(value);apply(next);}}}><optgroup label={t("ux.systemTemplates")}>{Object.keys(PORTAL_INVITATION_PRESETS).map(key=><option value={`preset:${key}`} key={key}>{t(`portalTemplates.preset.${key}`)}</option>)}</optgroup>{(["WORKSPACE","PERSONAL"] as const).map(visibility=><optgroup label={t(visibility==="WORKSPACE"?"ux.publicTemplates":"ux.personalTemplates")} key={visibility}>{templates.filter(item=>item.visibility===visibility).map(item=><option value={`saved:${item.id}`} key={item.id}>{item.name}</option>)}</optgroup>)}</select></label>
        <div className="email-filter-actions"><button type="button" className="secondary-button" onClick={()=>setEditor(true)}>{t(source?canManage?"ux.editTemplate":"ux.copyTemplate":"portalTemplates.saveTemplate")}</button><button type="button" className="secondary-button" onClick={()=>setAttempt(value=>value+1)}>{t("ux.reloadTemplates")}</button>{canManage&&<button type="button" className="text-button" onClick={()=>{setArchiveError("");setArchiveTarget(source!);}}>{t("ux.archiveTemplate")}</button>}</div>
        {templateError&&<InlineMessage type="error">{templateError}</InlineMessage>}
        <PortalRecipientPicker value={recipient} onChange={setRecipient}/>
        <div className="form-grid two-column"><label className="field"><span>{t("common.email")}</span><input type="email" required readOnly value={recipient?.email??""}/></label><label className="field"><span>{t("portal.expiry")}</span><DateInput name="expiresAt" type="datetime-local" required value={expires} onChange={event=>setExpires(event.target.value)}/></label></div>
        <label className="field"><span>{t("portalTemplates.language")}</span><select required value={language} onChange={event=>setLanguage(event.target.value as "zh-CN"|"en")}><option value="zh-CN">中文</option><option value="en">English</option></select></label>
        <p>{t("portalTemplates.variables")}</p>
        <label className="field"><span>{t("ux.subject")}</span><input required minLength={2} maxLength={180} value={language==="en"?content.subjectEn:content.subjectZh} onChange={event=>setContent(value=>({...value,[language==="en"?"subjectEn":"subjectZh"]:event.target.value}))}/></label>
        <label className="field"><span>{t("ux.body")}</span><textarea required rows={8} maxLength={10000} value={language==="en"?content.bodyEn:content.bodyZh} onChange={event=>setContent(value=>({...value,[language==="en"?"bodyEn":"bodyZh"]:event.target.value}))}/></label>
      </fieldset>
      {(formError||error)&&<InlineMessage type="error">{formError||error}</InlineMessage>}
      <div className="drawer-actions"><button type="button" className="secondary-button" disabled={pending||archivePending} onClick={onClose}>{t("common.cancel")}</button><button className="primary-button" disabled={pending||archivePending||!recipient||!canCreate}>{pending?t("common.saving"):t("portal.createLink")}</button></div>
    </form>
    {archiveTarget&&<ConfirmDialog title={t("ux.archiveTemplate")} description={archiveError||t("ux.archiveTemplateConfirm",{name:archiveTarget.name})} confirmLabel={t("ux.archiveTemplate")} pending={archivePending} onConfirm={()=>void archive()} onClose={()=>setArchiveTarget(null)}/>}
  </AccessibleDrawer>;
}
