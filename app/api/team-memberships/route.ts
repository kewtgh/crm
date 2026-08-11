import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { listUserTeamMemberships, requestTeamMembership } from "@/lib/team-repository";

const schema=z.object({teamId:z.uuid()});
const failure=(error:unknown)=>error instanceof DatabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"TEAM_MEMBERSHIP_FAILED"},{status:500});
async function get(){const user=await requireApiUser();try{return NextResponse.json(await listUserTeamMemberships(user.id));}catch(error){return failure(error);}}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});const user=await requireApiUser();const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT"},{status:400});try{return NextResponse.json(await requestTeamMembership(user.id,parsed.data.teamId),{status:202});}catch(error){return failure(error);}}
export const GET=apiRoute(get,"TEAM_MEMBERSHIP_LOAD_FAILED");
export const POST=apiRoute(post,"TEAM_MEMBERSHIP_REQUEST_FAILED");
