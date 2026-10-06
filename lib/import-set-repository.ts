import {databaseJson} from './db/gateway';
import {setActionSchema,setResources,normalizeSetRow,validateSetHeaders,type SetResource,type SetRow} from './import-set-contract';
import type {z} from 'zod';
export type ImportSetView={id:string;name:string;status:string;revision:number;batches:Array<{id:string;resource:SetResource;filename:string;status:string;total:number;applied:number}>;rows:Array<{id:string;batchId:string;resource:SetResource;row:number;sheet?:string;status:string;revision:number;operation:string;alias:string;normalized:SetRow;errors:Array<{code:string;field?:string}>;error:string|null;level:number}>;aliases:Array<{alias:string;resource:string;status:string;rowId:string}>;dependencies:Array<{row:string;parent:string}>};
export async function loadImportSets(setId?:string){return setId?databaseJson<ImportSetView>('/db/rpc/import_set_summary',{method:'POST',body:JSON.stringify({set_id:setId})}):databaseJson<Array<{id:string;name:string;status:string;revision:number}>>('/db/rpc/list_import_sets',{method:'POST',body:'{}'});}
export async function importSetAction(input:z.infer<typeof setActionSchema>){
 if(input.operation==='createSet')return databaseJson('/db/rpc/create_import_set',{method:'POST',body:JSON.stringify({set_name:input.name,p_request_key:input.requestKey})});
 if(input.operation==='addSetFile'){
  validateSetHeaders(input.file.resource,input.file.headers);if(input.file.rows.length!==input.file.rowLocations.length)throw Error('TEMPLATE_SCHEMA_INVALID');
  return databaseJson('/db/rpc/add_import_set_batch',{method:'POST',body:JSON.stringify({set_id:input.setId,expected_revision:input.expectedRevision,p_request_key:input.requestKey,resource:input.file.resource,filename:input.file.filename,content_hash:input.file.contentHash,headers:input.file.headers,rows:input.file.rows.map((r,i)=>normalizeSetRow(input.file.resource,r,input.file.rowLocations[i],input.file.sheet))})});
 }
 if(input.operation==='repairSetRow'){
  const view=await loadImportSets(input.setId) as ImportSetView;const row=view.rows.find(r=>r.id===input.rowId);if(!row||!(setResources as readonly string[]).includes(row.resource))throw Error('INVALID_REFERENCE');
  return databaseJson('/db/rpc/repair_import_set_row',{method:'POST',body:JSON.stringify({set_id:input.setId,row_id:input.rowId,expected_revision:input.expectedRevision,row_revision:input.rowRevision,replacement:normalizeSetRow(row.resource,input.replacement,row.row,row.sheet)})});
 }
 return databaseJson('/db/rpc/'+({preflightSet:'preflight_import_set',executeSet:'execute_import_set',rollbackSet:'rollback_import_set'}[input.operation]),{method:'POST',body:JSON.stringify({set_id:input.setId,expected_revision:input.expectedRevision,...(input.operation==='preflightSet'?{}:{max_rows:input.limit})})});
}
export function importSetError(error:unknown){const message=error instanceof Error?error.message:'';return ['ALIAS_CONFLICT','DEPENDENCY_CYCLE','BLOCKED_DEPENDENCY','INVALID_REFERENCE','STALE_TARGET','DUPLICATE_REVIEW','UNSUPPORTED_REASSIGNMENT','IMPORT_SET_LIMIT','IMPORT_NOT_READY','PAYLOAD_REUSE','UNKNOWN_COLUMN','TEMPLATE_SCHEMA_INVALID','CLEAR_NOT_ALLOWED'].find(c=>message.includes(c))??'IMPORT_SET_FAILED';}
