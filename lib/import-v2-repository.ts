import {normalizeLocalizedImport} from "./import-localized-headers";
import {databaseJson} from './db/gateway';
import {v2Headers,normalizeV2Row,validateV2Headers,v2CreateSchema,type V2Resource} from './import-v2';
import {z} from 'zod';
export async function createV2Import(input:z.infer<typeof v2CreateSchema>){
 input=normalizeLocalizedImport(input,v2Headers(input.resource));
 validateV2Headers(input.resource,input.headers);
 if(input.rows.length!==input.rowLocations.length)throw new Error('TEMPLATE_SCHEMA_INVALID');
 return databaseJson('/db/rpc/create_import_batch_v2',{method:'POST',body:JSON.stringify({resource:input.resource,filename:input.filename,content_hash:input.contentHash,request_key:input.requestKey,headers:input.headers,rows:input.rows.map((row,i)=>normalizeV2Row(input.resource,row,input.rowLocations[i],input.sheet))})});
}
export const v2ActionSchema=z.discriminatedUnion('operation',[
 z.object({operation:z.literal('saveMappingV2'),resource:z.enum(['ORGANIZATIONS','HOUSEHOLDS','CONTACTS']),name:z.string().min(1).max(80),mapping:z.record(z.string(),z.string()),expectedRevision:z.number().int().positive().nullable()}).strict(),
 z.object({operation:z.literal('processV2'),target_batch:z.uuid(),batch_size:z.number().int().min(1).max(100).default(100)}).strict(),
 z.object({operation:z.literal('rollbackV2'),target_batch:z.uuid(),requestKey:z.string().min(8).max(160)}).strict(),
 z.object({operation:z.literal('decideV2'),target_row:z.uuid(),expected_revision:z.number().int().positive(),chosen_action:z.enum(['CREATE','SKIP'])}).strict(),
 z.object({operation:z.literal('repairV2'),target_row:z.uuid(),expected_revision:z.number().int().positive(),replacement:z.record(z.string(),z.string().max(20000))}).strict(),
]);
export async function v2ImportAction(input:z.infer<typeof v2ActionSchema>){
 if(input.operation==='saveMappingV2')return databaseJson('/db/rpc/save_import_mapping_v2',{method:'POST',body:JSON.stringify({resource:input.resource,profile_name:input.name,mapping:input.mapping,version:'2',expected_revision:input.expectedRevision})});
 if(input.operation==='repairV2'){
  const rows=await databaseJson<Array<{source_location:{row:number;sheet?:string};import_batches:{resource_type:V2Resource}}>>(`/db/table/import_rows?select=source_location,import_batches(resource_type)&id=eq.${input.target_row}`);
  const row=rows[0];if(!row)throw new Error('INVALID_REFERENCE');
  return databaseJson('/db/rpc/repair_import_row_v2',{method:'POST',body:JSON.stringify({target_row:input.target_row,expected_revision:input.expected_revision,replacement:normalizeV2Row(row.import_batches.resource_type,input.replacement,row.source_location.row,row.source_location.sheet)})});
 }
 const {operation,requestKey,...body}=input as typeof input&{requestKey?:string};
 if(operation==='rollbackV2')Object.assign(body,{request_key:requestKey});
 return databaseJson(`/db/rpc/${operation==='processV2'?'process_import_batch_v2':operation==='rollbackV2'?'rollback_import_batch_v2':'decide_import_row_v2'}`,{method:'POST',body:JSON.stringify(body)});
}
export function safeImportError(error:unknown){
 const message=error instanceof Error?error.message:'';
 const code=['UNKNOWN_COLUMN','TEMPLATE_SCHEMA_INVALID','TEMPLATE_VERSION_UNSUPPORTED','STALE_TARGET','INVALID_REFERENCE','CLEAR_NOT_ALLOWED','UNSUPPORTED_OPERATION','IMPORT_REQUEST_CONFLICT','PAYLOAD_REUSE','IMPORT_NOT_READY','IMPORT_EVIDENCE_EXPIRED','PERMISSION_DENIED'].find(code=>message.includes(code));
 return code??'IMPORT_OPERATION_FAILED';
}
