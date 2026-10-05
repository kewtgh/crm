import {ApiError} from "./api";
import {readReportFilter} from "./management-trend-contract";
// Existing domain APIs own validation and authentication. This helper adds only
// explicit report predicates; a manipulated URL never widens domain access.
export function getDomainReportFilter(params:Record<string,unknown>,route:string){try{return readReportFilter(params,route);}catch{throw new ApiError("MANAGEMENT_DRILL_INVALID",400);}}
