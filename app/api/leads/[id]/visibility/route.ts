import {NextResponse} from "next/server";
import {ApiError,apiRoute,parseUuid,requireApiCapability} from "@/lib/api";
import {assignmentInputSchema} from "@/lib/lead-pool-input";
import {assignLead} from "@/lib/lead-assignment-repository";
import {mutationIsTrusted} from "@/lib/request-security";
export const POST=apiRoute(async(request:Request,context:{params:Promise<{id:string}>})=>{if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("leads.manage");const raw=await request.json();const {visibility,...input}=raw;if(!["PRIVATE","WORKSPACE_PUBLIC"].includes(visibility))throw new ApiError("LEAD_INPUT_INVALID",400);const parsed=assignmentInputSchema.safeParse(input);if(!parsed.success)throw new ApiError("LEAD_INPUT_INVALID",400);return NextResponse.json({item:await assignLead(parseUuid((await context.params).id),visibility==="PRIVATE"?"VISIBILITY_PRIVATE":"VISIBILITY_PUBLIC",parsed.data)});},"LEAD_ASSIGNMENT_FAILED");
