import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,requireApiRole} from "@/lib/api";
import {mutationIsTrusted} from "@/lib/request-security";
import {databaseJson} from "@/lib/db/gateway";
import {approvalRecordId,executeSuperAdminApproval} from "@/lib/governance-repository";
const schema=z.object({channel:z.enum(["EMAIL","SMS","PHONE","WECHAT","WHATSAPP"]),reason:z.string().trim().min(3).max(500)});
async function post(request:Request){
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  const user=await requireApiRole("SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER");
  const parsed=schema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return NextResponse.json({code:"INVALID_MARKETING_EXPORT"},{status:400});
  try{
    const item=await databaseJson("/db/rpc/request_marketing_contact_export",{method:"POST",body:JSON.stringify({export_channel:parsed.data.channel,business_reason:parsed.data.reason})});
    const approvalId=approvalRecordId(item);
    const direct=user.role==="SUPER_ADMIN";
    const execution=direct&&approvalId?await executeSuperAdminApproval(approvalId):undefined;
    return NextResponse.json({item,execution,direct});
  }catch{return NextResponse.json({code:"MARKETING_EXPORT_BLOCKED"},{status:409});}
}
export const POST=apiRoute(post,"MARKETING_EXPORT_BLOCKED");
