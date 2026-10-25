import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError,apiRoute,parseUuid,requireApiCapability } from "@/lib/api";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { mutationIsTrusted } from "@/lib/request-security";
import {executeCommunicationCommand,loadCommunications,loadCommunicationThread} from "@/lib/v220-repository";
import {communicationCommandSchema,communicationInboxQuerySchema,communicationResultSchema} from "@/lib/communications-contract";

const messagePagination=z.object({page:z.coerce.number().int().min(1).max(100000).optional(),pageSize:z.coerce.number().int().refine(value=>[10,20,50].includes(value)).default(20)});
function remapCommunicationError(error:unknown):never{
 if(error instanceof DatabaseRequestError){
  if(["COMMUNICATION_THREAD_IDEMPOTENCY_CONFLICT","COMMUNICATION_IDEMPOTENCY_CONFLICT","COMMUNICATION_REQUEST_CONFLICT","COMMUNICATION_VERSION_CONFLICT","COMMUNICATION_DELIVERY_NOT_RETRYABLE","COMMUNICATION_THREAD_NOT_OPEN"].includes(error.code))throw new ApiError(error.code,409);
  if(error.code==="COMMUNICATION_ACCESS_DENIED")throw new ApiError(error.code,403);
  if(error.code==="COMMUNICATION_THREAD_NOT_FOUND")throw new ApiError(error.code,404);
  if(["COMMUNICATION_INPUT_INVALID","COMMUNICATION_MESSAGE_INVALID","COMMUNICATION_THREAD_INVALID","COMMUNICATION_CONSENT_REQUIRED","COMMUNICATION_RECIPIENT_UNAVAILABLE"].includes(error.code))throw new ApiError(error.code,400);
 }
 throw error;
}
async function get(request:Request){
 await requireApiCapability("messages.view");const params=new URL(request.url).searchParams,threadId=params.get("threadId");
 try{
  if(threadId){
   const parsed=messagePagination.safeParse({page:params.get("messagePage")??undefined,pageSize:params.get("messagePageSize")??20});
   if(!parsed.success)throw new ApiError("INVALID_PAGINATION",400);
   return NextResponse.json(await loadCommunicationThread(parseUuid(threadId,"threadId"),parsed.data.page,parsed.data.pageSize));
  }
  const parsed=communicationInboxQuerySchema.safeParse(Object.fromEntries(params));
  if(!parsed.success)throw new ApiError("INVALID_COMMUNICATION_FILTER",400);
  const {q,page,pageSize,...filters}=parsed.data;
  return NextResponse.json(await loadCommunications(q,page,pageSize,filters));
 }catch(error){remapCommunicationError(error);}
}
async function post(request:Request){
 if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);
 await requireApiCapability("messages.manage");
 const parsed=communicationCommandSchema.safeParse(await request.json().catch(()=>({})));
 if(!parsed.success)throw new ApiError("INVALID_COMMUNICATION_INPUT",400,"INVALID_COMMUNICATION_INPUT",{field:String(parsed.error.issues[0]?.path[0]??"form")});
 try{
  const result=communicationResultSchema.parse(await executeCommunicationCommand(parsed.data));
  return NextResponse.json(result,{status:["send","retry"].includes(result.operation)&&result.deliveryStatus==="QUEUED"?202:200});
 }catch(error){remapCommunicationError(error);}
}
export const GET=apiRoute(get,"COMMUNICATION_LOAD_FAILED");
export const POST=apiRoute(post,"COMMUNICATION_OPERATION_FAILED");
