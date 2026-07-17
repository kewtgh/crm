import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiUser } from "@/lib/api";
import { loadContactPrivacy,saveContactConsent,setContactDoNotContact } from "@/lib/phase2-repository";
import { mutationIsTrusted } from "@/lib/request-security";
const consent=z.object({operation:z.literal("consent"),channel:z.enum(["EMAIL","SMS","PHONE","WECHAT","WHATSAPP"]),purpose:z.enum(["MARKETING","SERVICE","TRANSACTIONAL","EVENT"]),status:z.enum(["GRANTED","REVOKED"]),source:z.string().trim().min(1).max(120),evidence:z.string().trim().max(500).optional(),retentionUntil:z.string().date().nullable().optional(),quietStart:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),quietEnd:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional()});
const dnc=z.object({operation:z.literal("doNotContact"),enabled:z.boolean(),reason:z.string().trim().max(300)}).refine(value=>!value.enabled||value.reason.length>0,{path:["reason"]});const schema=z.discriminatedUnion("operation",[consent,dnc]);
async function get(_:Request,context:{params:Promise<{id:string}>}){await requireApiUser();const{id}=await context.params;try{return NextResponse.json(await loadContactPrivacy(id));}catch{return NextResponse.json({code:"CONTACT_PRIVACY_LOAD_FAILED"},{status:500});}}
async function post(request:Request,context:{params:Promise<{id:string}>}){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireApiUser();const{id}=await context.params;const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_CONSENT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});try{const item=parsed.data.operation==="consent"?await saveContactConsent({contactId:id,...parsed.data}):await setContactDoNotContact(id,parsed.data.enabled,parsed.data.reason);return NextResponse.json({item});}catch{return NextResponse.json({code:"CONSENT_SAVE_FAILED"},{status:500});}}
export const GET=apiRoute(get,"CONTACT_PRIVACY_LOAD_FAILED");
export const POST=apiRoute(post,"CONSENT_SAVE_FAILED");
