import {databaseJson,DatabaseRequestError} from './db/gateway';
import {objectStore} from './storage/object-store';
import {digest} from './contract-document-engine.mjs';
import {safeUploadName,uploadFormat,docxChunks} from './contract-extraction-engine.mjs';
import type {DocumentSourceKind,DocumentRequest} from './contract-document-repository';
export type UploadedRecord={id:string;filename:string;format:string;status:string;revision:number;sourceRevision:number;sha256:string;uploadedAt:string};
export type ExtractionCandidate={candidateKey:string;fieldKey:string;type:string;rawValue:string|null;normalizedValue:string|boolean|null;labelZh:string;labelEn:string;sourceExcerpt:string|null;sourceLocation:Record<string,string|number>|null;confidenceState:string;validationState:string;comparisonState:string;confirmationTarget:string;sensitive:boolean;masked?:boolean};
export type EvidenceDetail=UploadedRecord&{sourceKind:DocumentSourceKind;sourceId:string;context:DocumentRequest['context'];currentSourceRevision:number;sourceChanged:boolean;runId:string|null;runNumber:number;extractorVersion:string;errorCode:string|null;canonical:Record<string,string>;candidates:ExtractionCandidate[];chunks:Array<{index:number;text:string;location:Record<string,string|number>}>;reviews:Array<{candidate_key:string;decision:string;actor_id:string;reviewed_at:string;confirmed_value?:string|boolean;reason?:string}>};
export async function uploadRpc<T>(name:string,args:Record<string,unknown>):Promise<T>{try{return await databaseJson<T>(`/db/rpc/${name}`,{method:'POST',body:JSON.stringify(args)});}catch(error){if(error instanceof DatabaseRequestError&&error.code.startsWith('UPLOAD_'))throw new DatabaseRequestError(error.code.endsWith('NOT_FOUND')?404:/CONFLICT|BUSY/.test(error.code)?409:error.code.endsWith('FORBIDDEN')?403:400,error.code,error.code);throw error;}}
export async function storeContractUpload(input:{sourceKind:DocumentSourceKind;sourceId:string;expectedRevision:number;context:DocumentRequest['context'];requestKey:string},file:File){
 await uploadRpc('upload_context',{kind:input.sourceKind,source:input.sourceId,selected_context:input.context});
 const bytes=Buffer.from(await file.arrayBuffer()),format=uploadFormat(bytes,file.name,file.type),filename=safeUploadName(file.name);
 if(format==='DOCX')docxChunks(bytes); // Reject corrupt packages/external relations before persistence.
 const row=await uploadRpc<{id:string;key:string;status:string}>('reserve_contract_upload',{kind:input.sourceKind,source:input.sourceId,expected_revision:input.expectedRevision,selected_context:input.context,original_filename:filename,file_format:format,file_mime:file.type,file_bytes:bytes.length,file_sha:digest(bytes),p_request_key:input.requestKey});
 if(row.status==='STORING'){
  // Atomic create-only storage: concurrent same-SHA retries cannot overwrite/delete another completion.
  await objectStore().put(row.key,bytes,{contentType:file.type,checksum:digest(bytes)});
 }
 // A failed/ambiguous completion keeps the tracked private object for the same-key retry.
 await uploadRpc('complete_contract_upload',{record_id:row.id});return {id:row.id};
}
