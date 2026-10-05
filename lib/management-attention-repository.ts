import {databaseJson} from "./db/gateway";
import {attentionFiltersSchema,projectAttention,type AttentionFilters,type AttentionRawPage} from "./management-attention-contract";
export async function getManagementAttention(filters:AttentionFilters={},adapter=databaseJson){const raw=await adapter<AttentionRawPage>("/db/rpc/management_attention",{method:"POST",body:JSON.stringify({p_filters:attentionFiltersSchema.parse(filters)})});return projectAttention(raw);}
