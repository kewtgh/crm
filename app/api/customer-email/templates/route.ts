import { NextResponse } from "next/server";
import { ApiError,apiRoute,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { savedEmailSchema,archiveEmailSchema } from "@/lib/customer-email-input";
import { listCustomerEmailTemplates,saveCustomerEmailTemplate,archiveCustomerEmailTemplate } from "@/lib/customer-email-repository";
import { DatabaseRequestError } from "@/lib/db/gateway";
async function get(){await requireApiCapability("messages.manage");return NextResponse.json({items:await listCustomerEmailTemplates()},{headers:{"cache-control":"private, no-store"}});}
async function post(request:Request){
  if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
  const user=await requireApiCapability("messages.manage");
  const data=await request.json().catch(()=>null);
  const archive=archiveEmailSchema.safeParse(data);
  const input=savedEmailSchema.safeParse(data);
  if(archive.success){await templateMutation(()=>archiveCustomerEmailTemplate(archive.data.id,archive.data.expectedRevision));return NextResponse.json({archived:true});}
  if(!input.success)throw new ApiError("INVALID_INPUT",400);
  if(input.data.visibility==="WORKSPACE"&&!["SUPER_ADMIN","ADMIN"].includes(user.role))throw new ApiError("EMAIL_TEMPLATE_PUBLIC_FORBIDDEN",403);
  return NextResponse.json({item:await templateMutation(()=>saveCustomerEmailTemplate(input.data))});
}
async function templateMutation<T>(operation:()=>Promise<T>){
  try{return await operation();}catch(error){
    if(error instanceof DatabaseRequestError){
      if(["EMAIL_TEMPLATE_VERSION_CONFLICT","EMAIL_TEMPLATE_IDEMPOTENCY_CONFLICT"].includes(error.code))throw new ApiError(error.code,409);
      if(error.code==="EMAIL_TEMPLATE_NOT_FOUND")throw new ApiError(error.code,404);
      if(error.code==="EMAIL_TEMPLATE_PUBLIC_FORBIDDEN")throw new ApiError(error.code,403);
    }
    throw error;
  }
}
export const GET=apiRoute(get,"EMAIL_TEMPLATE_LOAD_FAILED");
export const POST=apiRoute(post,"EMAIL_TEMPLATE_SAVE_FAILED");
