import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,requireApiCapability} from "@/lib/api";
import {databaseJson} from "@/lib/db/gateway";
import {mutationIsTrusted} from "@/lib/request-security";
const text=z.string().trim().max(160);
const schema=z.object({id:z.uuid(),expectedUpdatedAt:z.string(),requestKey:z.string().min(8).max(160),data:z.object({nameZh:text,nameEn:text,phone:z.string().max(40),email:z.union([z.email(),z.literal("")]),occupation:text,employer:text,title:text,relationship:z.enum(["UNSPECIFIED","FATHER","MOTHER","GUARDIAN","OTHER"]).optional()}).strict()}).strict();
async function post(request:Request){
 if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireApiCapability("education.manage");
 const parsed=schema.safeParse(await request.json());if(!parsed.success)return NextResponse.json({code:"INVALID_EDUCATION_INPUT"},{status:400});const p=parsed.data;
 return NextResponse.json(await databaseJson("/db/rpc/save_household_person",{method:"POST",body:JSON.stringify({identity:p.id,expected_updated_at:p.expectedUpdatedAt,data:p.data,p_request_key:p.requestKey})}));
}
export const POST=apiRoute(post,"HOUSEHOLD_PERSON_SAVE_FAILED");
