import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError,apiRoute,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { CUSTOMER_EMAIL_TEMPLATES } from "@/lib/customer-email-templates";
import { previewCustomerEmail,queueCustomerEmail } from "@/lib/customer-email-repository";
import { customEmailSchema } from "@/lib/customer-email-input";
const schema=z.object({operation:z.enum(["preview","queue"]),contactIds:z.array(z.uuid()).min(1).max(50).refine(ids=>new Set(ids).size===ids.length),template:z.enum([...CUSTOMER_EMAIL_TEMPLATES,"CUSTOM"]),customTemplate:customEmailSchema.optional(),locale:z.enum(["zh-CN","en"]),requestKey:z.uuid(),previewHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}).refine(input=>input.template!=="CUSTOM"||!!input.customTemplate);
async function post(request:Request){
  if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
  await requireApiCapability("messages.manage");const parsed=schema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)throw new ApiError("INVALID_INPUT",400);
  const input=parsed.data,preview=await previewCustomerEmail(input.contactIds,input.template,input.locale,input.customTemplate);
  if(input.operation==="preview")return NextResponse.json(preview);
  if(input.previewHash!==preview.hash)throw new ApiError("EMAIL_PREVIEW_CHANGED",409);
  return NextResponse.json(await queueCustomerEmail(preview.items,input.requestKey));
}
export const POST=apiRoute(post,"CUSTOMER_EMAIL_FAILED");
