import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { completeDashboardTask } from "@/lib/dashboard-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { SupabaseRequestError } from "@/lib/supabase-server";
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});try{await requireUser();await completeDashboardTask((await context.params).id);return NextResponse.json({ok:true});}catch(error){return error instanceof SupabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"TASK_UPDATE_FAILED"},{status:500});}}
