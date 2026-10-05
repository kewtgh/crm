import {NextResponse} from "next/server";
import {ApiError,apiRoute,requireApiCapability} from "./api";
import {overviewFiltersSchema,trendFiltersSchema} from "./management-trend-contract";
import {getManagementOverview,getManagementTrends} from "./management-intelligence-repository";
export const managementOverviewRead=apiRoute(async(request:Request)=>{
 await requireApiCapability("education.view");const parsed=overviewFiltersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)throw new ApiError("MANAGEMENT_INPUT_INVALID",400);
 return NextResponse.json(await getManagementOverview(parsed.data),{headers:{"cache-control":"no-store"}});
},"MANAGEMENT_LOAD_FAILED");

export const managementTrendsRead=apiRoute(async(request:Request)=>{await requireApiCapability("education.view");const parsed=trendFiltersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)throw new ApiError("MANAGEMENT_INPUT_INVALID",400);return NextResponse.json(await getManagementTrends(parsed.data),{headers:{"cache-control":"no-store"}});},"MANAGEMENT_LOAD_FAILED");
