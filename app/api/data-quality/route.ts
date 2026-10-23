import {NextResponse} from "next/server";
import {ApiError,apiRoute,parsePagination,requireApiCapability} from "@/lib/api";
import {mutationIsTrusted} from "@/lib/request-security";
import {DatabaseRequestError} from "@/lib/db/gateway";
import {qualityCommandSchema,qualityFilterSchema,qualityParams} from "@/lib/quality-contract";
import {executeQualityCommand,loadQualityWorkspace} from "@/lib/quality-workspace-repository";
async function get(request:Request){
 const user=await requireApiCapability("dataQuality.manage"),params=new URL(request.url).searchParams,{page,pageSize}=parsePagination(params,10);
 const parsed=qualityFilterSchema.safeParse(qualityParams(params));if(!parsed.success)throw new ApiError("INVALID_QUALITY_FILTER",400);
 const {q,...filters}=parsed.data;
 return NextResponse.json(await loadQualityWorkspace({...filters,query:q.trim(),page,pageSize,actorId:user.id}));
}
async function post(request:Request){
 if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
 await requireApiCapability("dataQuality.manage");const parsed=qualityCommandSchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)throw new ApiError("INVALID_QUALITY_INPUT",400);
 try{return NextResponse.json({item:await executeQualityCommand(parsed.data)});}
 catch(error){if(error instanceof DatabaseRequestError){const status=["QUALITY_VERSION_CONFLICT","QUALITY_REQUEST_CONFLICT","QUALITY_SOURCE_NOT_FIXED"].includes(error.code)?409:error.code==="QUALITY_NOT_AUTHORIZED"?403:error.status;throw new ApiError(error.code,status);}throw error;}
}
export const GET=apiRoute(get,"QUALITY_LOAD_FAILED");
export const POST=apiRoute(post,"QUALITY_OPERATION_FAILED");
