import {databaseJson,DatabaseRequestError} from "./db/gateway";
import {recyclePageSchema,recycleQuerySchema,recycleRestoreSchema,recycleRestoredSchema,type RecycleQuery,type RecycleScope,type RecycleRestore} from "./recycle-contract";
export type {RecycleBinItem,RecyclePage} from "./recycle-contract";

export async function loadRecyclePage(scope:RecycleScope,query:RecycleQuery,adapter=databaseJson){
  const parsed=recycleQuerySchema.parse(query);
  const result=await adapter<unknown>("/db/rpc/query_recycle_records",{method:"POST",body:JSON.stringify({p_scope:scope,p_query:parsed.q.trim(),p_kind:parsed.kind,p_retention:parsed.retention,p_page:parsed.page,p_page_size:parsed.pageSize})});
  const page=recyclePageSchema.safeParse(result);
  if(!page.success||page.data.scope!==scope||page.data.page!==parsed.page||page.data.pageSize!==parsed.pageSize)throw new DatabaseRequestError(502,"INVALID_RECYCLE_RESPONSE","Unconfirmed recovery page");
  return page.data;
}
export async function restoreRecycleRecord(input:RecycleRestore,adapter=databaseJson){
  const command=recycleRestoreSchema.parse(input);
  const result=await adapter<unknown>("/db/rpc/restore_recycle_record_command",{method:"POST",body:JSON.stringify({p_scope:command.scope,p_kind:command.kind,p_id:command.id,p_deleted_at:command.expectedDeletedAt,p_request_key:command.requestKey})});
  const restored=recycleRestoredSchema.safeParse(result);
  if(!restored.success||restored.data.id.toLowerCase()!==command.id.toLowerCase()||restored.data.kind!==command.kind)throw new DatabaseRequestError(502,"INVALID_RECYCLE_RESPONSE","Unconfirmed restore result");
  return restored.data;
}
