import {NextResponse} from "next/server";
import {ApiError,apiRoute,requireApiCapability,requireApiUser} from "@/lib/api";
import {mutationIsTrusted} from "@/lib/request-security";
import {DatabaseRequestError} from "@/lib/db/gateway";
import {executePrivacyCommand,listPrivacyRequests} from "@/lib/privacy-request-repository";
import {privacyCommandSchema,privacyViewSchema} from "@/lib/privacy-request-contract";
async function get(request:Request){
 await requireApiUser();const params=new URL(request.url).searchParams;
 if([...params.keys()].length!==new Set(params.keys()).size)throw new ApiError("PRIVACY_VIEW_INVALID",400);
 const parsed=privacyViewSchema.safeParse(Object.fromEntries(params));if(!parsed.success)throw new ApiError("PRIVACY_VIEW_INVALID",400);
 return NextResponse.json(await listPrivacyRequests(parsed.data),{headers:{"cache-control":"private, no-store"}});
}
async function post(request:Request){
 if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
 await requireApiUser();const parsed=privacyCommandSchema.safeParse(await request.json().catch(()=>null));
 if(!parsed.success)throw new ApiError("PRIVACY_INPUT_INVALID",400);
 if(parsed.data.operation==="manage")await requireApiCapability("privacyRequests.manage");
 try{return NextResponse.json({item:await executePrivacyCommand(parsed.data)},{status:parsed.data.operation==="create"?201:200});}
 catch(error){if(error instanceof DatabaseRequestError&&["PRIVACY_SNAPSHOT_CONFLICT","PRIVACY_REQUEST_CONFLICT"].includes(error.code))throw new ApiError(error.code,409);throw error;}
}
export const GET=apiRoute(get,"PRIVACY_REQUEST_LOAD_FAILED");
export const POST=apiRoute(post,"PRIVACY_REQUEST_CREATE_FAILED");
