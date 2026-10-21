import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,requireApiAal2,requireApiUser} from "@/lib/api";
import {mutationIsTrusted} from "@/lib/request-security";
import {databaseJson} from "@/lib/db/gateway";
import {deletionResources} from "@/lib/record-deletion-contract";

const schema=z.object({kind:z.enum(["ORGANIZATION","CONTACT","TASK","STUDENT","HOUSEHOLD","PRODUCT","LEAD",...deletionResources.map(item=>item.kind)]),id:z.uuid()});
async function post(request:Request){
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  const user=await requireApiUser();
  if(user.role==="SUPER_ADMIN"||user.role==="ADMIN")await requireApiAal2();
  const parsed=schema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return NextResponse.json({code:"INVALID_RECYCLE_ITEM"},{status:400});
  await databaseJson(user.role==="SUPER_ADMIN"?"/db/rpc/restore_crm_recycle_bin":"/db/rpc/restore_personal_recycle_record",{method:"POST",body:JSON.stringify({entity_kind:parsed.data.kind,entity_id:parsed.data.id})});
  return NextResponse.json({ok:true});
}
export const POST=apiRoute(post,"RECYCLE_RESTORE_FAILED");
