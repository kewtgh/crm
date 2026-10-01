import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError,apiRoute,requireApiUser,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { loadCustomerOperations,saveCustomerFollowUp } from "@/lib/customer-operations-repository";
import { hasCapability } from "@/lib/capabilities";

const subjectSchema=z.enum(["ORGANIZATION","CONTACT","HOUSEHOLD"]);
const identity=z.object({subject:subjectSchema,id:z.uuid()});
const details=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("contract"),contractId:z.uuid()}),
  z.object({operation:z.literal("plan"),title:z.string().trim().min(1).max(200),targetLevel:z.number().int().min(1).max(4),targetCount:z.number().int().min(1).max(1000),startDate:z.string().date(),dueDate:z.string().date()}).refine(value=>value.dueDate>=value.startDate),
  z.object({operation:z.literal("entry"),kind:z.enum(["CALL","EMAIL","MEETING","VISIT","NOTE"]),summary:z.string().trim().min(1).max(2000),nextStep:z.string().trim().min(1).max(1000),occurredAt:z.string().datetime({offset:true}),requestKey:z.uuid()}),
]);
async function get(request:Request){const user=await requireApiUser();const value=identity.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!value.success)throw new ApiError("INVALID_INPUT",400);if(value.data.subject==="HOUSEHOLD")await requireApiCapability("education.view");try{return NextResponse.json(await loadCustomerOperations(value.data.subject,value.data.id,{contracts:hasCapability(user.role,"contracts.view"),opportunities:hasCapability(user.role,"opportunities.view")}),{headers:{"cache-control":"no-store"}});}catch(error){if(error instanceof Error&&error.message==="CRM_RECORD_NOT_FOUND")throw new ApiError("CRM_RECORD_NOT_FOUND",404);throw error;}}
async function post(request:Request){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiUser();const body=await request.json().catch(()=>({}));const target=identity.safeParse(body),action=details.safeParse(body);if(!target.success||!action.success)throw new ApiError("INVALID_INPUT",400);if(target.data.subject==="HOUSEHOLD")await requireApiCapability("education.manage");if(action.data.operation==="contract")await requireApiCapability("contracts.view");return NextResponse.json({item:await saveCustomerFollowUp(target.data.subject,target.data.id,action.data.operation,action.data)});}
export const GET=apiRoute(get,"CUSTOMER_OPERATIONS_FAILED");
export const POST=apiRoute(post,"CUSTOMER_OPERATIONS_FAILED");
