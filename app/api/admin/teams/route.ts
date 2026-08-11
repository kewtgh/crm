import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiAal2, requireApiRole } from "@/lib/api";
import { listTeamLeadCandidates, listTeams, saveTeam } from "@/lib/team-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { DatabaseRequestError } from "@/lib/db/gateway";

const schema=z.object({
  id:z.uuid().optional(),code:z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-]+$/),
  nameZh:z.string().trim().min(1).max(100),nameEn:z.string().trim().min(1).max(120),
  descriptionMarkdown:z.string().max(4000).default(""),leadUserId:z.uuid().nullable().optional(),active:z.boolean().default(true),
});
const fail=(error:unknown)=>error instanceof DatabaseRequestError
  ?NextResponse.json({code:error.code},{status:error.status})
  :NextResponse.json({code:"TEAM_OPERATION_FAILED"},{status:500});
async function get(){await requireApiRole("SUPER_ADMIN","ADMIN");await requireApiAal2();try{const[items,leadCandidates]=await Promise.all([listTeams(),listTeamLeadCandidates()]);return NextResponse.json({items,leadCandidates});}catch(error){return fail(error);}}
async function post(request:Request){
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  const actor=await requireApiRole("SUPER_ADMIN","ADMIN");await requireApiAal2();
  const parsed=schema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return NextResponse.json({code:"INVALID_TEAM_INPUT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});
  try{return NextResponse.json({item:await saveTeam(parsed.data,actor)},{status:parsed.data.id?200:201});}catch(error){return fail(error);}
}
export const GET=apiRoute(get,"TEAM_LOAD_FAILED");
export const POST=apiRoute(post,"TEAM_OPERATION_FAILED");
