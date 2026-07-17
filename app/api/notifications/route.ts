import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { listNotifications,markNotificationsRead } from "@/lib/notifications-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { SupabaseRequestError } from "@/lib/supabase-server";
const schema=z.object({ids:z.array(z.uuid()).max(100).optional()});
const fail=(error:unknown)=>error instanceof SupabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"NOTIFICATIONS_FAILED"},{status:500});
export async function GET(request:Request){try{await requireUser();const url=new URL(request.url);return NextResponse.json(await listNotifications(Number(url.searchParams.get("page")??1),Math.max(1,Math.min(100,Number(url.searchParams.get("pageSize")??10)))));}catch(error){return fail(error);}}
export async function PATCH(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT"},{status:400});try{await requireUser();await markNotificationsRead(parsed.data.ids);return NextResponse.json({ok:true});}catch(error){return fail(error);}}
