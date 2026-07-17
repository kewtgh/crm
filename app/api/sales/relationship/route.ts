import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiAal2, requireApiRole, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { recordRelationshipMilestone, saveRelationshipTargets } from "@/lib/sales-repository";
import { SupabaseRequestError } from "@/lib/supabase-server";

const targetSchema=z.object({operation:z.literal("targets"),periodStart:z.string().date(),periodEnd:z.string().date(),managerId:z.string().uuid().nullable().optional(),contact:z.number().int().min(0).max(100),meal:z.number().int().min(0).max(100),family:z.number().int().min(0).max(100),advocacy:z.number().int().min(0).max(100)});
const milestoneSchema=z.object({operation:z.literal("milestone"),organizationId:z.string().uuid(),milestone:z.enum(["CONTACT","MEAL","FAMILY_CHAT","ADVOCACY"]),evidence:z.string().trim().min(3).max(500)});
const schema=z.discriminatedUnion("operation",[targetSchema,milestoneSchema]);
const fail=(error:unknown)=>error instanceof SupabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"RELATIONSHIP_SAVE_FAILED"},{status:500});
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});await requireApiUser();if(parsed.data.operation==="targets"){await requireApiRole("SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER");await requireApiAal2();}try{return NextResponse.json({item:parsed.data.operation==="targets"?await saveRelationshipTargets(parsed.data):await recordRelationshipMilestone(parsed.data)});}catch(error){return fail(error);}}
export const POST=apiRoute(post,"RELATIONSHIP_SAVE_FAILED");
