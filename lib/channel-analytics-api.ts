import {NextResponse} from "next/server";
import {ApiError,apiRoute,requireApiCapability} from "./api";
import {channelApiError} from "./channel-commercial-api";
import {channelAnalyticsFilters} from "./channel-analytics-input";
import {getChannelAnalytics} from "./channel-analytics-repository";
export const channelAnalyticsRead=apiRoute(async(request:Request,context?:{params:Promise<{organizationId:string}>})=>{
 await requireApiCapability("education.view");
 const q=new URL(request.url).searchParams;
 const data:Record<string,unknown>=Object.fromEntries(q);
 if(context?.params)data.organization=(await context.params).organizationId;
 const parsed=channelAnalyticsFilters.safeParse(data);
 if(!parsed.success)throw new ApiError("CHANNEL_ANALYTICS_INPUT_INVALID",400);
 try{return NextResponse.json(await getChannelAnalytics(parsed.data),{headers:{"cache-control":"no-store"}});}catch(e){return channelApiError(e);}
},"CHANNEL_ANALYTICS_LOAD_FAILED");
