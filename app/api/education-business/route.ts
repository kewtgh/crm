import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError,apiRoute,parsePagination,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { DatabaseRequestError,databaseJson } from "@/lib/db/gateway";
import { businessResources,businessSaveSchema,type BusinessContext } from "@/lib/education-business";
import { listEducationBusiness,saveEducationBusiness } from "@/lib/education-business-repository";

const contextSchema=z.object({type:z.enum(["ORGANIZATION","HOUSEHOLD","STUDENT"]),id:z.uuid()});
async function get(request:Request){
  await requireApiCapability("education.view");
  const params=new URL(request.url).searchParams;
  const resource=z.enum(businessResources).safeParse(params.get("resource")??"organizations");
  if(!resource.success)throw new ApiError("BUSINESS_INPUT_INVALID",400);
  let context:BusinessContext|undefined;
  if(params.has("subject")||params.has("subjectId")){
    const parsed=contextSchema.safeParse({type:params.get("subject"),id:params.get("subjectId")});
    if(!parsed.success)throw new ApiError("BUSINESS_CONTEXT_INVALID",400);
    context=parsed.data;
    const allowed=await databaseJson<boolean>(context.type==="STUDENT"?"/db/rpc/education_business_student_access":"/db/rpc/customer_subject_access",{method:"POST",body:JSON.stringify(context.type==="STUDENT"?{subject:context.id,edit:false}:{subject_kind:context.type,subject:context.id,edit:false})});
    if(!allowed)throw new ApiError("BUSINESS_RECORD_NOT_FOUND",404);
  }
  try{return NextResponse.json(await listEducationBusiness(resource.data,{...parsePagination(params,20),context,query:params.get("q")??""}),{headers:{"cache-control":"no-store"}});}
  catch(error){if(error instanceof Error&&error.message==="BUSINESS_CONTEXT_INVALID")throw new ApiError("BUSINESS_CONTEXT_INVALID",400);throw error;}
}
async function post(request:Request){
  if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
  await requireApiCapability("education.manage");
  const input=businessSaveSchema.safeParse(await request.json().catch(()=>({})));
  if(!input.success)throw new ApiError("BUSINESS_INPUT_INVALID",400,"BUSINESS_INPUT_INVALID",{field:input.error.issues[0]?.path.join(".")});
  try{return NextResponse.json({item:await saveEducationBusiness(input.data)},{headers:{"cache-control":"no-store"}});}
  catch(error){
    if(error instanceof DatabaseRequestError){
      if(error.code==="BUSINESS_VERSION_CONFLICT")throw new ApiError(error.code,409);
      if(error.code==="BUSINESS_UPDATE_FORBIDDEN")throw new ApiError(error.code,403);
      if(error.code==="BUSINESS_RECORD_NOT_FOUND"||error.code==="BUSINESS_RELATED_NOT_FOUND")throw new ApiError(error.code,404);
      if(["BUSINESS_EVENT_SOURCE_MISMATCH","BUSINESS_PARENT_IMMUTABLE","BUSINESS_INPUT_INVALID","CONSTRAINT_VIOLATION"].includes(error.code))throw new ApiError(error.code,400);
    }
    throw error;
  }
}
export const GET=apiRoute(get,"BUSINESS_LOAD_FAILED");
export const POST=apiRoute(post,"BUSINESS_SAVE_FAILED");
