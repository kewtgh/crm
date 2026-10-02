import { NextResponse } from "next/server";
import { ApiError,apiRoute,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { savedEmailSchema } from "@/lib/customer-email-input";
import { listCustomerEmailTemplates,saveCustomerEmailTemplate } from "@/lib/customer-email-repository";
async function get(){await requireApiCapability("messages.manage");return NextResponse.json({items:await listCustomerEmailTemplates()},{headers:{"cache-control":"private, no-store"}});}
async function post(request:Request){
  if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
  await requireApiCapability("messages.manage");
  const input=savedEmailSchema.safeParse(await request.json().catch(()=>null));
  if(!input.success)throw new ApiError("INVALID_INPUT",400);
  return NextResponse.json({item:await saveCustomerEmailTemplate(input.data)});
}
export const GET=apiRoute(get,"EMAIL_TEMPLATE_LOAD_FAILED");
export const POST=apiRoute(post,"EMAIL_TEMPLATE_SAVE_FAILED");
