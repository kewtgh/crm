import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,requireApiAal2,requireApiRole} from "@/lib/api";
import {mutationIsTrusted} from "@/lib/request-security";
import {supabaseJson} from "@/lib/supabase-server";

const schema=z.object({kind:z.enum(["ORGANIZATION","CONTACT","TASK","STUDENT","HOUSEHOLD"]),id:z.uuid()});
async function post(request:Request){
  if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
  await requireApiRole("SUPER_ADMIN");
  await requireApiAal2();
  const parsed=schema.safeParse(await request.json().catch(()=>({})));
  if(!parsed.success)return NextResponse.json({code:"INVALID_RECYCLE_ITEM"},{status:400});
  await supabaseJson("/rest/v1/rpc/restore_crm_recycle_bin",{method:"POST",body:JSON.stringify({entity_kind:parsed.data.kind,entity_id:parsed.data.id})});
  return NextResponse.json({ok:true});
}
export const POST=apiRoute(post,"RECYCLE_RESTORE_FAILED");
