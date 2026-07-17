import {NextResponse} from "next/server";
import {z} from "zod";
import {requireRole} from "@/lib/auth";
import {mutationIsTrusted} from "@/lib/request-security";
import {supabaseJson} from "@/lib/supabase-server";
const schema=z.object({channel:z.enum(["EMAIL","SMS","PHONE","WECHAT","WHATSAPP"]),reason:z.string().trim().min(3).max(500)});
export async function POST(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireRole("SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER");const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_MARKETING_EXPORT"},{status:400});try{return NextResponse.json({item:await supabaseJson("/rest/v1/rpc/request_marketing_contact_export",{method:"POST",body:JSON.stringify({export_channel:parsed.data.channel,business_reason:parsed.data.reason})})});}catch{return NextResponse.json({code:"MARKETING_EXPORT_BLOCKED"},{status:409});}}
