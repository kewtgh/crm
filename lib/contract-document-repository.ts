import {databaseJson,DatabaseRequestError} from "./db/gateway";
import {readDocumentCatalog,readRegisteredTemplate} from "./contract-document-files.mjs";
import {openDocumentConfiguration} from "./contract-document-configuration.mjs";
import {DocumentError,productionEligibility,renderDocx,resolveDocumentFields} from "./contract-document-engine.mjs";

export type DocumentSourceKind="CUSTOMER_CONTRACT"|"CHANNEL_AGREEMENT_VERSION";
export type DocumentField={key:string;label_zh:string;label_en:string;category:string;type:string;required:boolean;sensitive:boolean;source:string;source_path:string;required_if?:{field:string;equals:boolean}};
export type DocumentTemplate={id:string|null;template_key:string;version_number:number;status:string;active:boolean;approved_by:string|null;approved_at:string|null;fields:DocumentField[];template_path:string;template_sha256:string;review_items:string[]};
type TemplateRow={id:string;definition:DocumentTemplate;status:string;active:boolean;approved_by:string|null;approved_at:string|null};
type Configuration={id:string;encrypted_values:Record<string,unknown>;approved_by:string;approved_at:string};
export type DocumentRecord={id:string;documentVersion:number;status:string;sourceRevision:number;templateKey:string;templateVersion:number;templateSHA256:string;generatedAt:string|null;generatedBy:string;artifactSHA256:string|null};
export type DocumentOptions={sourceRevision:number;contexts:Array<{enrollmentId?:string;cohortId:string;productId:string;label:string}>;rules:Array<{commissionRuleId:string;basis:string;scope:string;productId:string|null;cohortId:string|null}>};
export type DocumentRequest={sourceKind:DocumentSourceKind;sourceId:string;expectedRevision:number;templateKey:string;templateVersion:number;context:{enrollmentId?:string;productId?:string;cohortId?:string;commissionRuleId?:string};confirmedValues:Record<string,string|boolean>;requestKey:string;regenerationReason:string};
const rpc=async<T>(name:string,data:Record<string,unknown>)=>{try{return await databaseJson<T>(`/db/rpc/${name}`,{method:"POST",body:JSON.stringify(data)});}catch(error){if(error instanceof DatabaseRequestError&&error.code.startsWith("DOCUMENT_"))throw new DatabaseRequestError(error.code.endsWith("NOT_FOUND")?404:/CONFLICT|NOT_APPROVED|BLOCKED/.test(error.code)?409:400,error.code,error.code);throw error;}};
export async function documentTemplates(kind:DocumentSourceKind):Promise<DocumentTemplate[]> {
  const key=kind==="CUSTOMER_CONTRACT"?"student-program":"channel-recruitment";
  const rows=await databaseJson<TemplateRow[]>(`/db/table/contract_document_template_versions?select=id,definition,status,active,approved_by,approved_at&template_key=eq.${key}&order=version_number.desc&limit=100`);
  if(rows.length)return rows.map(r=>({...r.definition,id:r.id,status:r.status,active:r.active,approved_by:r.approved_by,approved_at:r.approved_at}));
  const catalog=await readDocumentCatalog();
  return catalog.versions.filter((v:DocumentTemplate)=>v.template_key===key).map((v:DocumentTemplate)=>({...v,id:null,active:false}));
}
export async function getDocumentWorkspace(kind:DocumentSourceKind,source:string) {
  // Authorize parent before reading template configuration or lineage.
  const options=await rpc<DocumentOptions>("document_source_options",{kind,source});
  const [templates,canPreviewDraft,items]=await Promise.all([documentTemplates(kind),rpc<boolean>("document_governance_allowed",{}),rpc<DocumentRecord[]>("list_contract_documents",{kind,source})]);
  return {options,items,canPreviewDraft,templates:templates.filter(v=>v.status==="APPROVED"&&v.active||canPreviewDraft&&v.status==="DRAFT").map(v=>({id:v.id,key:v.template_key,version:v.version_number,status:v.status,active:v.active,
    fields:v.fields.map(f=>({...f,editable:f.category==="USER_CONFIRMED"&&!(/^company\./.test(f.key)||kind==="CUSTOMER_CONTRACT"&&/^bank\./.test(f.key))})),reviewItems:v.review_items}))};
}
export async function resolveDocumentRequest(input:DocumentRequest) {
  const context=await rpc<{sourceId:string;sourceRevision:number;canonical:Record<string,string>;actorId:string;references:Record<string,string>}>("document_generation_context",{kind:input.sourceKind,source:input.sourceId,context:input.context});
  if(context.sourceRevision!==input.expectedRevision)throw new DocumentError("DOCUMENT_SOURCE_CONFLICT");
  const versions=await documentTemplates(input.sourceKind);
  const version=versions.find(v=>v.template_key===input.templateKey&&v.version_number===input.templateVersion);
  if(!version)throw new DocumentError("TEMPLATE_NOT_FOUND");
  if(version.status!=="APPROVED"&&!(version.status==="DRAFT"&&await rpc<boolean>("document_governance_allowed",{})))throw new DocumentError("TEMPLATE_NOT_APPROVED");
  const configs=await databaseJson<Configuration[]>("/db/table/contract_document_configurations?select=id,encrypted_values,approved_by,approved_at&status=eq.APPROVED&active=eq.true&limit=1");
  const cfg=configs[0],staticValues=cfg?openDocumentConfiguration(cfg.encrypted_values):{};
  const bytes=await readRegisteredTemplate(version);
  const resolved=resolveDocumentFields(version,context,input.confirmedValues,staticValues,{id:context.actorId,at:new Date().toISOString(),configurationId:cfg?.id,configurationApprovedBy:cfg?.approved_by,configurationApprovedAt:cfg?.approved_at});
  return {version,context,resolved,bytes,configurationReady:!!cfg};
}
export async function previewContractDocument(input:DocumentRequest) {
  const result=await resolveDocumentRequest(input);
  return {...result,artifact:renderDocx(result.version,result.bytes,{...result.resolved.values,"template.review_notice":"PREVIEW ONLY / 仅供预览，不是正式合同"})};
}
export async function requestContractDocument(input:DocumentRequest) {
  const previous=await rpc<string|null>("document_request_receipt",{template_key:input.templateKey,template_version:input.templateVersion,kind:input.sourceKind,source:input.sourceId,expected_revision:input.expectedRevision,context:input.context,confirmed_values:input.confirmedValues,p_request_key:input.requestKey,regeneration_reason:input.regenerationReason});
  if(previous)return previous;
  const result=await resolveDocumentRequest(input);
  productionEligibility(result.version,result.version.active?result.version.version_number:null,result.resolved.issues);
  if(!result.version.id||!result.configurationReady)throw new DocumentError("DOCUMENT_CONFIGURATION_REQUIRED");
  return rpc<string>("request_contract_document",{template_id:result.version.id,kind:input.sourceKind,source:input.sourceId,expected_revision:input.expectedRevision,
    context:input.context,confirmed_values:input.confirmedValues,p_request_key:input.requestKey,regeneration_reason:input.regenerationReason});
}
export function downloadContractDocument(id:string){return rpc<{id:string;key:string;sha256:string;bytes:number;reference:string;version:number}>("contract_document_download",{record_id:id});}
