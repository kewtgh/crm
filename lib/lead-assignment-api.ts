import {NextResponse} from "next/server";
import {ApiError,apiRoute,parseUuid,requireApiCapability} from "./api";
import {mutationIsTrusted} from "./request-security";
import {assignmentInputSchema} from "./lead-pool-input";
import {assignLead,listLeadAssignmentHistory,getPoolLead} from "./lead-assignment-repository";
import {DatabaseRequestError} from "./db/gateway";
export function leadAssignmentRoute(operation:string){return apiRoute(async(request:Request,context:{params:Promise<{id:string}>})=>{
 if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("leads.manage");
 const id=parseUuid((await context.params).id),parsed=assignmentInputSchema.safeParse(await request.json().catch(()=>({})));
 if(!parsed.success)throw new ApiError("LEAD_INPUT_INVALID",400);
 if((operation==="RELEASE"||operation==="REASSIGN")&&!parsed.data.reason)throw new ApiError("LEAD_REASON_REQUIRED",400);
 try{return NextResponse.json({item:await assignLead(id,operation,parsed.data)});}catch(error){if(error instanceof DatabaseRequestError)throw new ApiError(error.code,error.code.includes("FORBIDDEN")?403:error.code.includes("CONFLICT")||error.code.includes("ALREADY")?409:error.status);throw error;}
 },"LEAD_ASSIGNMENT_FAILED");}
export const leadHistoryRoute=apiRoute(async(_request:Request,context:{params:Promise<{id:string}>})=>{await requireApiCapability("leads.view");const id=parseUuid((await context.params).id);if(!await getPoolLead(id))throw new ApiError("LEAD_NOT_FOUND",404);return NextResponse.json({items:await listLeadAssignmentHistory(id)});},"LEAD_LOAD_FAILED");
