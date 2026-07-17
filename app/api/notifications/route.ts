import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, parsePagination, requireApiUser } from "@/lib/api";
import { listNotifications,markNotificationsRead } from "@/lib/notifications-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { SupabaseRequestError } from "@/lib/supabase-server";
const schema=z.object({ids:z.array(z.uuid()).max(100).optional()});
const fail=(error:unknown)=>error instanceof SupabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"NOTIFICATIONS_FAILED"},{status:500});
async function get(request:Request){await requireApiUser();const url=new URL(request.url);const{page,pageSize}=parsePagination(url.searchParams,10);try{return NextResponse.json(await listNotifications(page,pageSize));}catch(error){return fail(error);}}
async function patch(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT"},{status:400});await requireApiUser();try{await markNotificationsRead(parsed.data.ids);return NextResponse.json({ok:true});}catch(error){return fail(error);}}
export const GET=apiRoute(get,"NOTIFICATIONS_FAILED");
export const PATCH=apiRoute(patch,"NOTIFICATIONS_FAILED");
