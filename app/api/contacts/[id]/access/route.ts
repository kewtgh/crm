import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,parseUuid,requireApiUser} from "@/lib/api";
import {databaseJson} from "@/lib/db/gateway";
import {mutationIsTrusted} from "@/lib/request-security";
const schema=z.object({recipient:z.uuid(),level:z.enum(["READ","EDIT","REVOKE"]),requestKey:z.string().min(8).max(160)}).strict();
async function get(_:Request,context:{params:Promise<{id:string}>}){
 await requireApiUser();const identity=parseUuid((await context.params).id);
 return NextResponse.json(await databaseJson("/db/rpc/contact_access_snapshot",{method:"POST",body:JSON.stringify({identity})}));
}
async function post(request:Request,context:{params:Promise<{id:string}>}){
 if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
 await requireApiUser();const identity=parseUuid((await context.params).id),input=schema.parse(await request.json());
 return NextResponse.json(await databaseJson("/db/rpc/share_contact",{method:"POST",body:JSON.stringify({identity,recipient:input.recipient,level:input.level,p_request_key:input.requestKey})}));
}
export const GET=apiRoute(get,"CONTACT_ACCESS_LOAD_FAILED");
export const POST=apiRoute(post,"CONTACT_ACCESS_SAVE_FAILED");
