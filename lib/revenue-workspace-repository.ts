import {databaseJson} from './db/gateway';
import type {RevenueWorkspace} from './revenue-workspace';

export function loadRevenueWorkspace(input: {entity?: string; contract?: string; page?: number; status?: string; currency?: string; q?: string} = {}, adapter=databaseJson) {
  return adapter<RevenueWorkspace>('/db/rpc/revenue_workspace_read',{method:'POST',body:JSON.stringify({entity:input.entity??null,contract_filter:input.contract??null,page_number:input.page??1,filters:{status:input.status??'',currency:input.currency??'',q:input.q??''}})});
}
