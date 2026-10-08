import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,parseUuid,requireApiAal2,requireApiRole} from "@/lib/api";
import {mutationIsTrusted} from "@/lib/request-security";
import {removeUnusedStaffAccount,staffRemovalEligibility} from "@/lib/admin-users-repository";

type Context={params:Promise<{id:string}>};
export const GET=apiRoute(async(_request:Request,context:Context)=>{
  await requireApiRole("ADMIN","SUPER_ADMIN");await requireApiAal2();
  return NextResponse.json(await staffRemovalEligibility(parseUuid((await context.params).id)));
},"STAFF_REMOVAL_CHECK_FAILED");
export const POST=apiRoute(async(request:Request,context:Context)=>{
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  await requireApiRole("ADMIN","SUPER_ADMIN");await requireApiAal2();
  const parsed=z.object({requestKey:z.string().min(8).max(160),confirmation:z.literal("REMOVE_UNUSED_ACCOUNT")}).strict().safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return NextResponse.json({code:"INVALID_INPUT"},{status:400});
  return NextResponse.json({item:await removeUnusedStaffAccount(parseUuid((await context.params).id),parsed.data.requestKey)});
},"STAFF_REMOVAL_FAILED");
