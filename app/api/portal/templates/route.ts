import { NextResponse } from "next/server";
import { ApiError,apiRoute,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { archiveEmailSchema } from "@/lib/customer-email-input";
import { savedPortalTemplateSchema } from "@/lib/portal-invitation-templates";
import { archivePortalTemplate,listPortalTemplates,savePortalTemplate } from "@/lib/portal-template-repository";
async function get(){await requireApiCapability("portal.manage");return NextResponse.json({items:await listPortalTemplates()},{headers:{"cache-control":"private, no-store"}});}
async function post(request:Request){
  if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
  const user=await requireApiCapability("portal.manage");
  const data=await request.json().catch(()=>null),archive=archiveEmailSchema.safeParse(data),input=savedPortalTemplateSchema.safeParse(data);
  try{
    if(archive.success){await archivePortalTemplate(archive.data.id,archive.data.expectedRevision);return NextResponse.json({archived:true});}
    if(!input.success)throw new ApiError("INVALID_INPUT",400);
    if(input.data.visibility==="WORKSPACE"&&!["ADMIN","SUPER_ADMIN"].includes(user.role))throw new ApiError("EMAIL_TEMPLATE_PUBLIC_FORBIDDEN",403);
    return NextResponse.json({item:await savePortalTemplate(input.data)});
  }catch(error){
    if(error instanceof DatabaseRequestError){
      if(["EMAIL_TEMPLATE_VERSION_CONFLICT","EMAIL_TEMPLATE_IDEMPOTENCY_CONFLICT"].includes(error.code))throw new ApiError(error.code,409);
      if(error.code==="EMAIL_TEMPLATE_NOT_FOUND")throw new ApiError(error.code,404);
      if(error.code==="EMAIL_TEMPLATE_PUBLIC_FORBIDDEN")throw new ApiError(error.code,403);
    }
    throw error;
  }
}
export const GET=apiRoute(get,"PORTAL_TEMPLATE_LOAD_FAILED");
export const POST=apiRoute(post,"PORTAL_TEMPLATE_SAVE_FAILED");
