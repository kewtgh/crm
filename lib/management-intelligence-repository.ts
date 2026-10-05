import {databaseJson} from "./db/gateway";
import {type ManagementFilters} from "./management-metric-contract";
import {overviewFiltersSchema,trendFiltersSchema,type TrendFilters,type ManagementTrends} from "./management-trend-contract";
import {projectManagementOverview,type ManagementReadModel} from "./management-overview-projection";
export async function getManagementOverview(filters:ManagementFilters&Pick<TrendFilters,"productId"|"cohortId">={},adapter=databaseJson){const raw=await adapter<ManagementReadModel>("/db/rpc/management_overview_filtered",{method:"POST",body:JSON.stringify({p_filters:overviewFiltersSchema.parse(filters)})});return projectManagementOverview(raw);}

export async function getManagementTrends(filters:TrendFilters={},adapter=databaseJson){return adapter<ManagementTrends>("/db/rpc/management_trends",{method:"POST",body:JSON.stringify({p_filters:trendFiltersSchema.parse(filters)})});}
