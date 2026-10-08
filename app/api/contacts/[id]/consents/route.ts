import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, parseUuid, requireApiUser } from "@/lib/api";
import { loadContactPrivacy } from "@/lib/phase2-repository";
import {databaseJson} from "@/lib/db/gateway";
import { mutationIsTrusted } from "@/lib/request-security";
const consent=z.object({operation:z.literal("consent"),requestKey:z.string().min(8).max(160),channel:z.enum(["EMAIL","SMS","PHONE","WECHAT","WHATSAPP"]),purpose:z.enum(["MARKETING","SERVICE","TRANSACTIONAL","EVENT"]),status:z.enum(["GRANTED","REVOKED"]),source:z.string().trim().min(1).max(120),evidence:z.string().trim().max(500).optional(),retentionUntil:z.string().date().nullable().optional(),quietStart:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(),quietEnd:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional()});
const dnc=z.object({operation:z.literal("doNotContact"),requestKey:z.string().min(8).max(160),enabled:z.boolean(),reason:z.string().trim().max(300)}).refine(value=>!value.enabled||value.reason.length>0,{path:["reason"]});const schema=z.discriminatedUnion("operation",[consent,dnc]);
async function get(_:Request,context:{params:Promise<{id:string}>}){await requireApiUser();const id=parseUuid((await context.params).id);return NextResponse.json(await loadContactPrivacy(id));}
async function post(request:Request,context:{params:Promise<{id:string}>}){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireApiUser();const id=parseUuid((await context.params).id);const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_CONSENT",field:String(parsed.error.issues[0]?.path[0]??"form")},{status:400});const {requestKey,...data}=parsed.data;const item=await databaseJson("/db/rpc/record_contact_consent",{method:"POST",body:JSON.stringify({identity:id,data,p_request_key:requestKey})});return NextResponse.json({item});}
export const GET=apiRoute(get,"CONTACT_PRIVACY_LOAD_FAILED");
export const POST=apiRoute(post,"CONSENT_SAVE_FAILED");
