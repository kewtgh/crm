import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,requireApiCapability} from "@/lib/api";
import {databaseJson} from "@/lib/db/gateway";
import {mutationIsTrusted} from "@/lib/request-security";
const text=z.string().trim().max(160).default("");
const person=z.object({nameZh:text,nameEn:text,email:z.union([z.email(),z.literal("")]).default(""),phone:z.string().max(40).default(""),occupation:text,employer:text,title:text,role:z.enum(["PARENT","GUARDIAN","PAYER","OTHER"]),primary:z.boolean()}).strict().refine(v=>!!(v.nameZh||v.nameEn));
const schema=z.object({requestKey:z.string().min(8).max(160),household:z.object({nameZh:text,nameEn:text,address:z.string().max(1000).default(""),preferredLanguage:text,educationExpectationsMarkdown:z.string().max(10000).default(""),familyBackgroundMarkdown:z.string().max(10000).default("")}).strict().refine(v=>!!(v.nameZh||v.nameEn)),people:z.array(person).min(1).max(10)}).strict();
async function post(request:Request){
 if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});
 await requireApiCapability("education.manage");const parsed=schema.safeParse(await request.json());
 if(!parsed.success)return NextResponse.json({code:"INVALID_EDUCATION_INPUT"},{status:400});
 const {requestKey,...data}=parsed.data;
 return NextResponse.json({item:await databaseJson("/db/rpc/create_household_with_people",{method:"POST",body:JSON.stringify({data,p_request_key:requestKey})})},{status:201});
}
export const POST=apiRoute(post,"HOUSEHOLD_CREATE_FAILED");
