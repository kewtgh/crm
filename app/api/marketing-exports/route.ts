import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,requireApiRole} from "@/lib/api";
import {mutationIsTrusted} from "@/lib/request-security";
import {supabaseJson} from "@/lib/supabase-server";
const schema=z.object({channel:z.enum(["EMAIL","SMS","PHONE","WECHAT","WHATSAPP"]),reason:z.string().trim().min(3).max(500)});
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireApiRole("SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER");const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_MARKETING_EXPORT"},{status:400});try{return NextResponse.json({item:await supabaseJson("/rest/v1/rpc/request_marketing_contact_export",{method:"POST",body:JSON.stringify({export_channel:parsed.data.channel,business_reason:parsed.data.reason})})});}catch{return NextResponse.json({code:"MARKETING_EXPORT_BLOCKED"},{status:409});}}
export const POST=apiRoute(post,"MARKETING_EXPORT_BLOCKED");
