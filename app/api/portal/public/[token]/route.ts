import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError,apiRoute } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { acceptPublicPortalConsent,loadPublicPortal,submitPublicPortalUpdate } from "@/lib/v220-repository";

const tokenSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const operationSchema=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("consent"),requestKey:z.string().trim().min(8).max(120),accepted:z.literal(true)}),
  z.object({operation:z.literal("update"),requestKey:z.string().trim().min(8).max(120),changes:z.object({address:z.string().trim().max(500).optional(),preferredContact:z.string().trim().max(160).optional(),note:z.string().trim().max(1000).optional()}).refine(value=>Object.values(value).some(Boolean))}),
]);
async function token(context:{params:Promise<{token:string}>}){const parsed=tokenSchema.safeParse((await context.params).token);if(!parsed.success)throw new ApiError("PORTAL_INVITATION_INVALID",404);return parsed.data;}
async function get(_:Request,context:{params:Promise<{token:string}>}){return NextResponse.json({data:await loadPublicPortal(await token(context))},{headers:{"cache-control":"no-store"}});}
async function post(request:Request,context:{params:Promise<{token:string}>}){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);const parsed=operationSchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)throw new ApiError("INVALID_PORTAL_UPDATE",400);const portalToken=await token(context);if(parsed.data.operation==="consent"){await acceptPublicPortalConsent(portalToken,parsed.data.requestKey);return NextResponse.json({data:await loadPublicPortal(portalToken)});}const id=await submitPublicPortalUpdate(portalToken,parsed.data.requestKey,Object.fromEntries(Object.entries(parsed.data.changes).filter(([,value])=>value)));return NextResponse.json({id},{status:201});}
export const GET=apiRoute(get,"PORTAL_ACCESS_FAILED");
export const POST=apiRoute(post,"PORTAL_UPDATE_FAILED");
