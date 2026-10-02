import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError,apiRoute,requireApiCapability } from "@/lib/api";
import { databaseJson } from "@/lib/db/gateway";
const filters=z.object({q:z.string().trim().max(160).default(""),region:z.string().trim().max(80).default(""),tag:z.string().trim().max(120).default(""),type:z.string().trim().max(40).default(""),page:z.coerce.number().int().min(1).max(10000).default(1)});
async function get(request:Request){
  await requireApiCapability("messages.manage");
  const input=filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if(!input.success)throw new ApiError("INVALID_INPUT",400);
  const {q,region,tag,type,page}=input.data;
  return NextResponse.json(await databaseJson("/db/rpc/customer_email_recipients",{method:"POST",body:JSON.stringify({search_query:q,region,tag,customer_type:type,page_number:page})}),{headers:{"cache-control":"private, no-store"}});
}
export const GET=apiRoute(get,"EMAIL_RECIPIENT_LOAD_FAILED");
