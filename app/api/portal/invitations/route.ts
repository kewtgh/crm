import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError,apiRoute,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { createPortalInvitation,decidePortalUpdate,loadPortalWorkspace,revokePortalInvitation } from "@/lib/v220-repository";

const schema=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("create"),householdId:z.uuid(),guardianContactId:z.uuid().nullable().optional(),email:z.email(),expiresAt:z.iso.datetime()}),
  z.object({operation:z.literal("revoke"),id:z.uuid()}),
  z.object({operation:z.literal("decide"),id:z.uuid(),status:z.enum(["APPROVED","REJECTED"]),note:z.string().trim().min(3).max(1000)}),
]);
async function get(){await requireApiCapability("portal.manage");return NextResponse.json(await loadPortalWorkspace());}
async function post(request:Request){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("portal.manage");const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)throw new ApiError("INVALID_PORTAL_OPERATION",400,"INVALID_PORTAL_OPERATION",{field:String(parsed.error.issues[0]?.path[0]??"form")});let invitationUrl="";if(parsed.data.operation==="create"){const created=await createPortalInvitation(parsed.data);invitationUrl=`${new URL(request.url).origin}/portal/invite/${created.token}`;}else if(parsed.data.operation==="revoke")await revokePortalInvitation(parsed.data.id);else{await requireApiCapability("portal.decide");await decidePortalUpdate(parsed.data.id,parsed.data.status,parsed.data.note);}return NextResponse.json({...await loadPortalWorkspace(),invitationUrl});}
export const GET=apiRoute(get,"PORTAL_LOAD_FAILED");
export const POST=apiRoute(post,"PORTAL_OPERATION_FAILED");
