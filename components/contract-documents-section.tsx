"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import type {DocumentSourceKind,DocumentField,DocumentOptions,DocumentRecord,DocumentRequest} from "@/lib/contract-document-repository";
import {apiFetch} from "@/lib/api-client";
import {useI18n} from "./i18n-provider";
import {ContractUploadEvidence} from "./contract-upload-evidence";
import {InlineMessage} from "./ui";
type Template={id:string|null;key:string;version:number;status:string;active:boolean;fields:Array<DocumentField&{editable:boolean}>;reviewItems:string[]};
type Workspace={canPreviewDraft:boolean;options:DocumentOptions;items:DocumentRecord[];templates:Template[]};
type Review={fields:Array<{key:string;source:string;value:string;sensitive:boolean}>;issues:Array<{key:string;code:string}>};
export function ContractDocumentsSection({sourceKind,sourceId,canManage=true}:{sourceKind:DocumentSourceKind;sourceId:string;canManage?:boolean}) {
 const {t,locale}=useI18n(),[data,setData]=useState<Workspace|null>(null),[draftPreview,setDraftPreview]=useState(false),[template,setTemplate]=useState(""),[context,setContext]=useState(""),[rule,setRule]=useState(""),[confirmed,setConfirmed]=useState<Record<string,string|boolean>>({}),[review,setReview]=useState<Review|null>(null),[message,setMessage]=useState(""),[busy,setBusy]=useState(false),[reason,setReason]=useState(""),[uncertain,setUncertain]=useState(false);
 const pending=useRef<DocumentRequest|null>(null);
 const load=useCallback(async()=>{const result=await apiFetch<Workspace>(`/api/contract-documents?sourceKind=${sourceKind}&sourceId=${sourceId}`);setData(result);},[sourceKind,sourceId]);
 useEffect(()=>{let active=true;void apiFetch<Workspace>(`/api/contract-documents?sourceKind=${sourceKind}&sourceId=${sourceId}`).then(result=>{if(active)setData(result);}).catch(()=>{if(active)setMessage(t("documents.loadFailed"));});return ()=>{active=false;};},[sourceKind,sourceId,t]);
 const selected=data?.templates.find(v=>`${v.key}:${v.version}`===template);
 const resetReview=()=>{setReview(null);setMessage("");};
 const requestInput=():DocumentRequest|null=>{
  const chosen=data?.options.contexts.find(v=>(v.enrollmentId??v.cohortId)===context);
  if(!selected||!chosen||sourceKind==="CHANNEL_AGREEMENT_VERSION"&&!rule){setMessage(t("documents.selectRequired"));return null;}
  return {sourceKind,sourceId,expectedRevision:data!.options.sourceRevision,templateKey:selected.key,templateVersion:selected.version,context:sourceKind==="CUSTOMER_CONTRACT"?{enrollmentId:chosen.enrollmentId}:{productId:chosen.productId,cohortId:chosen.cohortId,commissionRuleId:rule},confirmedValues:confirmed,requestKey:crypto.randomUUID(),regenerationReason:reason};
 };
 const run=async(operation:"validate"|"preview"|"generate",retry=false)=>{
  const input=retry?pending.current:requestInput();if(!input)return;
  if(operation==="generate")pending.current=input;
  setBusy(true);setMessage("");
  try {
   if(operation==="preview"){
    const csrf=document.cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith("crm_csrf="))?.slice(9)??"";
    const response=await fetch("/api/contract-documents",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json","x-csrf-token":decodeURIComponent(csrf)},body:JSON.stringify({...input,operation})});
    if(!response.ok){const payload=await response.json();throw Object.assign(new Error("DOCUMENT_PREVIEW_FAILED"),{code:payload.code});}
    const url=URL.createObjectURL(await response.blob()),a=document.createElement("a");a.href=url;a.download="PREVIEW-ONLY.docx";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }else{
    const result=await apiFetch<Review&{id:string}>("/api/contract-documents",{method:"POST",body:JSON.stringify({...input,operation})});
    if(operation==="validate")setReview(result);
    else{pending.current=null;setUncertain(false);setMessage(t("documents.queued"));await load().catch(()=>setMessage(t("documents.loadFailed")));}
   }
  }catch(error){
   const code=String((error as {code?:string}).code??"");
   if(operation==="generate"&&(!code||((error as {status?:number}).status??0)>=500||/TIMEOUT|NETWORK|ABORTED/.test(code))){setUncertain(true);setMessage(t("documents.unknownRetry"));}
   else{pending.current=null;setUncertain(false);setMessage(t(code.includes("CONFLICT")?"documents.conflict":/APPROVED|BLOCKED|CONFIGURATION|MISSING/.test(code)?"documents.blocked":"documents.failed"));}
  }finally{setBusy(false);}
 };
 return <section className="detail-section" data-contract-documents={sourceKind}>
  <h3>{t("documents.title")}</h3><p>{t("documents.notSigned")}</p>
  {message&&<InlineMessage type={message===t("documents.queued")?"success":"error"}>{message}</InlineMessage>}
  {data&&<><p>{t("documents.sourceRevision")}: {data.options.sourceRevision}</p>
   {canManage&&<details className="document-generation-panel"><summary>{t("documents.generate")}</summary><fieldset disabled={busy||uncertain} style={{border:0,padding:0,minWidth:0}}>
    {data.canPreviewDraft&&<label className="field"><span><input type="checkbox" style={{width:16,height:16,minHeight:16,margin:0,verticalAlign:"middle"}} checked={draftPreview} onChange={e=>{setDraftPreview(e.target.checked);setTemplate("");setConfirmed({});resetReview();}}/> {t("documents.draftPreview")}</span></label>}
    <div className="form-grid"><label className="field"><span>{t("documents.template")}</span><select value={template} onChange={e=>{setTemplate(e.target.value);setConfirmed({});resetReview();}}><option value="">{t("documents.selectTemplate")}</option>{data.templates.filter(v=>draftPreview?v.status==="DRAFT":v.status==="APPROVED"&&v.active).map(v=><option key={`${v.key}:${v.version}`} value={`${v.key}:${v.version}`}>{v.key} v{v.version} · {t(`documents.status.${v.status}`)}</option>)}</select></label>
    <label className="field"><span>{t("documents.context")}</span><select value={context} onChange={e=>{setContext(e.target.value);resetReview();}}><option value="">—</option>{data.options.contexts.map(v=><option key={v.enrollmentId??v.cohortId} value={v.enrollmentId??v.cohortId}>{v.label} · {(v.enrollmentId??v.cohortId).slice(0,8)}</option>)}</select></label></div>
    {sourceKind==="CHANNEL_AGREEMENT_VERSION"&&<label className="field"><span>{t("documents.rule")}</span><select value={rule} onChange={e=>{setRule(e.target.value);resetReview();}}><option value="">—</option>{data.options.rules.map(r=><option key={r.commissionRuleId} value={r.commissionRuleId}>{r.basis} · {r.commissionRuleId.slice(0,8)}</option>)}</select></label>}
    {selected&&<>{selected.status!=="APPROVED"&&<InlineMessage type="info">{t("documents.previewOnly")}</InlineMessage>}<p>{t(sourceKind==="CUSTOMER_CONTRACT"?"documents.configuration":"documents.channelConfiguration")}</p><h4>{t("documents.confirmed")}</h4>
    {selected.fields.filter(f=>f.editable).map(f=><label className="field" key={f.key}><span>{locale==="en"?f.label_en:f.label_zh}{f.required?" *":""}{f.sensitive?` · ${t("documents.sensitive")}`:""}</span>{f.type==="boolean"?<select value={confirmed[f.key]===true?"true":confirmed[f.key]===false?"false":""} onChange={e=>{setConfirmed(v=>{const next={...v};if(e.target.value==="")delete next[f.key];else next[f.key]=e.target.value==="true";return next;});resetReview();}}><option value="">—</option><option value="true">{t("documents.yes")}</option><option value="false">{t("documents.no")}</option></select>:f.sensitive?<input type="password" autoComplete="off" value={String(confirmed[f.key]??"")} maxLength={5000} onChange={e=>{setConfirmed(v=>({...v,[f.key]:e.target.value}));resetReview();}}/>:<textarea rows={2} value={String(confirmed[f.key]??"")} maxLength={5000} onChange={e=>{setConfirmed(v=>({...v,[f.key]:e.target.value}));resetReview();}}/>}</label>)}
    <label className="field"><span>{t("documents.regenerationReason")}</span><textarea value={reason} maxLength={500} onChange={e=>setReason(e.target.value)} /></label>
    <div className="page-actions"><button className="secondary-button" onClick={()=>void run("validate")}>{t("documents.validate")}</button><button className="secondary-button" onClick={()=>void run("preview")}>{t("documents.preview")}</button><button className="primary-button" disabled={!selected.active||selected.status!=="APPROVED"||!review||review.issues.length>0} onClick={()=>void run("generate")}>{t("documents.generate")}</button></div>
    {!data.templates.some(v=>v.status==="APPROVED"&&v.active)&&<p>{t("documents.noApproved")}</p>}
    </>}
   </fieldset></details>}
   {uncertain&&<button disabled={busy} className="secondary-button" onClick={()=>void run("generate",true)}>{t("documents.retry")}</button>}
   {review&&<div data-document-review><h4>{t("documents.canonical")}</h4>{review.fields.map(f=><p key={f.key} style={{overflowWrap:"anywhere"}}><b>{f.key}</b> · {f.source} · {f.value}</p>)}{review.issues.map(i=><InlineMessage type="error" key={i.key}>{t(i.code==="UNSUPPORTED_FIELD"?"documents.unsupported":"documents.missing")}: {i.key}</InlineMessage>)}</div>}
   <div className="surface-heading"><h4>{t("documents.history")}</h4><button className="secondary-button" disabled={busy} onClick={()=>void load().catch(()=>setMessage(t("documents.loadFailed")))}>{t("documents.refresh")}</button></div>
   {!data.items.length&&<p>{t("documents.empty")}</p>}
   <div className="detail-record-list">{data.items.map(d=><article key={d.id} data-document-id={d.id} style={{overflowWrap:"anywhere"}}><b>{t("uploads.generated")} · {t("documents.version")} {d.documentVersion} · {t(`documents.status.${d.status}`)}</b><p>{d.templateKey} v{d.templateVersion} · {t("documents.sourceRevision")} {d.sourceRevision}</p><p>{d.generatedAt??"—"} · {d.generatedBy}</p><p>SHA256: {d.artifactSHA256??"—"}</p>{d.status==="GENERATED"&&<a className="secondary-button" style={{whiteSpace:"nowrap",flexShrink:0}} href={`/api/contract-documents/${d.id}/download`}>{t("documents.download")}</a>}</article>)}</div>
   <details className="document-evidence-panel"><summary>{locale==="en"?"Upload signed document / evidence":"上传已签署文件／证据"}</summary><ContractUploadEvidence sourceKind={sourceKind} sourceId={sourceId} sourceRevision={data.options.sourceRevision} canManage={canManage} context={sourceKind==="CUSTOMER_CONTRACT"&&context?{enrollmentId:context}:sourceKind==="CHANNEL_AGREEMENT_VERSION"&&context&&rule?{cohortId:context,productId:data.options.contexts.find(v=>v.cohortId===context)?.productId,commissionRuleId:rule}:{}}/></details>
  </>}
 </section>;
}
