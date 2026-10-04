import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "@/lib/api";
import {DatabaseRequestError} from "@/lib/db/gateway";
import {mutationIsTrusted} from "@/lib/request-security";
import {milestoneFiltersSchema,milestoneSaveSchema} from "@/lib/admission-milestone-input";
import {getMilestone,listMilestones,listMilestoneStatusHistory,saveMilestone} from "@/lib/admission-milestone-repository";
import {getEnrollment} from "@/lib/enrollment-repository";
import {getApplication} from "@/lib/application-repository";
function fail(error:unknown):never{if(error instanceof DatabaseRequestError){const code=error.code,status=code.endsWith("_CONFLICT")||code==="MILESTONE_PARENT_IMMUTABLE"?409:code.endsWith("_NOT_FOUND")?404:code.endsWith("_FORBIDDEN")?403:error.status;throw new ApiError(code,status);}throw error;}
async function get(request:Request){await requireApiCapability("education.view");const params=new URL(request.url).searchParams;try{
 if(params.has("id")){const id=z.uuid().safeParse(params.get("id")),page=z.coerce.number().int().min(1).max(100000).safeParse(params.get("page")??1);if(!id.success||!page.success)throw new ApiError("MILESTONE_INPUT_INVALID",400);const item=await getMilestone(id.data);if(!item)throw new ApiError("MILESTONE_NOT_FOUND",404);return NextResponse.json(params.get("resource")==="history"?{items:await listMilestoneStatusHistory(id.data,page.data)}:{item});}
 const parsed=milestoneFiltersSchema.safeParse(Object.fromEntries(params));if(!parsed.success)throw new ApiError("MILESTONE_INPUT_INVALID",400);if(!await getEnrollment(parsed.data.enrollmentId))throw new ApiError("MILESTONE_ENROLLMENT_NOT_FOUND",404);
 if(parsed.data.applicationId){const application=await getApplication(parsed.data.applicationId);if(!application||application.enrollment_id!==parsed.data.enrollmentId)throw new ApiError("MILESTONE_APPLICATION_FORBIDDEN",403);}
 return NextResponse.json(await listMilestones(parsed.data));}catch(error){return fail(error);}}
async function save(request:Request){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("education.manage");const parsed=milestoneSaveSchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success||request.method==="PATCH"&&parsed.data.expectedRevision===null)throw new ApiError("MILESTONE_INPUT_INVALID",400);try{return NextResponse.json({item:await saveMilestone(parsed.data)});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"MILESTONE_LOAD_FAILED");export const POST=apiRoute(save,"MILESTONE_SAVE_FAILED");export const PATCH=apiRoute(save,"MILESTONE_SAVE_FAILED");
