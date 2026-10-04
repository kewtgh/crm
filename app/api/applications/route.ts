import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "@/lib/api";
import {DatabaseRequestError} from "@/lib/db/gateway";
import {mutationIsTrusted} from "@/lib/request-security";
import {applicationFiltersSchema,applicationSaveSchema} from "@/lib/application-input";
import {getApplication,listApplications,listApplicationStatusHistory,listApplicationTasks,saveApplication} from "@/lib/application-repository";
function fail(error:unknown):never{if(error instanceof DatabaseRequestError){const code=error.code,status=code.endsWith("_CONFLICT")||code==="APPLICATION_PARENT_IMMUTABLE"?409:code.endsWith("_NOT_FOUND")?404:code.endsWith("_FORBIDDEN")?403:error.status;throw new ApiError(code,status);}throw error;}
async function get(request:Request){await requireApiCapability("education.view");const params=new URL(request.url).searchParams;
 try{if(params.has("id")){const id=z.uuid().safeParse(params.get("id")),page=z.coerce.number().int().min(1).max(100000).safeParse(params.get("page")??1);if(!id.success||!page.success)throw new ApiError("APPLICATION_INPUT_INVALID",400);const item=await getApplication(id.data);if(!item)throw new ApiError("APPLICATION_NOT_FOUND",404);if(params.get("resource")==="history")return NextResponse.json({items:await listApplicationStatusHistory(id.data,page.data)});if(params.get("resource")==="tasks")return NextResponse.json({items:await listApplicationTasks(id.data,page.data)});return NextResponse.json({item});}
 const parsed=applicationFiltersSchema.safeParse(Object.fromEntries(params));if(!parsed.success)throw new ApiError("APPLICATION_INPUT_INVALID",400);return NextResponse.json(await listApplications(parsed.data));}catch(error){return fail(error);}
}
async function save(request:Request){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("education.manage");const parsed=applicationSaveSchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success||request.method==="PATCH"&&parsed.data.expectedRevision===null)throw new ApiError("APPLICATION_INPUT_INVALID",400);try{return NextResponse.json({item:await saveApplication(parsed.data)});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"APPLICATION_LOAD_FAILED");export const POST=apiRoute(save,"APPLICATION_SAVE_FAILED");export const PATCH=apiRoute(save,"APPLICATION_SAVE_FAILED");
