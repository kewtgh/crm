import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiAal2, requireApiRole } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { setUserTeamMemberships } from "@/lib/team-repository";

const schema=z.object({userId:z.uuid(),teamIds:z.array(z.uuid()).max(50)});
async function post(request:Request){
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  const actor=await requireApiRole("SUPER_ADMIN","ADMIN");await requireApiAal2();
  const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT"},{status:400});
  try{return NextResponse.json(await setUserTeamMemberships(parsed.data.userId,parsed.data.teamIds,actor));}catch(error){return error instanceof DatabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"TEAM_MEMBERSHIP_UPDATE_FAILED"},{status:500});}
}
export const POST=apiRoute(post,"TEAM_MEMBERSHIP_UPDATE_FAILED");
