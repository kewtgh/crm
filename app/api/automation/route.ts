import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError,apiRoute,parseUuid,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { createAutomationRule,loadAutomationWorkspace,previewAutomationRule,retryAutomationRun,runAutomationEvent,setAutomationRuleActive } from "@/lib/v220-repository";

const trigger=z.enum(["LEAD_CREATED","LEAD_STATUS_CHANGED","OPPORTUNITY_STAGE_CHANGED","CONTRACT_RENEWAL_DUE","MANUAL"]);
const schema=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("create"),nameZh:z.string().trim().min(2).max(160),nameEn:z.string().trim().min(2).max(160),triggerKey:trigger,conditionField:z.enum(["status","source","stage","currency"]).optional(),conditionValue:z.string().trim().max(160).optional(),actionType:z.enum(["TASK","NOTIFICATION"]),titleZh:z.string().trim().min(2).max(160),titleEn:z.string().trim().min(2).max(160),priority:z.enum(["LOW","NORMAL","HIGH","URGENT"]),dueHours:z.number().int().min(1).max(2160)}),
  z.object({operation:z.literal("toggle"),id:z.uuid(),active:z.boolean()}),
  z.object({operation:z.literal("run"),triggerKey:trigger,eventKey:z.string().trim().min(8).max(240),payload:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).default({})}),
  z.object({operation:z.literal("preview"),id:z.uuid(),payload:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).default({})}),
  z.object({operation:z.literal("retry"),id:z.uuid()}),
]);
async function get(){await requireApiCapability("automation.manage");return NextResponse.json(await loadAutomationWorkspace());}
async function post(request:Request){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("automation.manage");const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)throw new ApiError("INVALID_AUTOMATION_INPUT",400,"INVALID_AUTOMATION_INPUT",{field:String(parsed.error.issues[0]?.path[0]??"form")});let preview;if(parsed.data.operation==="create")await createAutomationRule(parsed.data);else if(parsed.data.operation==="toggle")await setAutomationRuleActive(parseUuid(parsed.data.id),parsed.data.active);else if(parsed.data.operation==="run")await runAutomationEvent({trigger:parsed.data.triggerKey,eventKey:parsed.data.eventKey,payload:parsed.data.payload});else if(parsed.data.operation==="preview")preview=await previewAutomationRule(parseUuid(parsed.data.id),parsed.data.payload);else await retryAutomationRun(parseUuid(parsed.data.id));return NextResponse.json({...await loadAutomationWorkspace(),preview});}
export const GET=apiRoute(get,"AUTOMATION_LOAD_FAILED");
export const POST=apiRoute(post,"AUTOMATION_OPERATION_FAILED");
