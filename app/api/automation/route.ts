import { automationInputSchema } from "@/lib/automation-input";
import { NextResponse } from "next/server";
import { ApiError,apiRoute,parseUuid,requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { createAutomationRule,loadAutomationWorkspace,previewAutomationRule,retryAutomationRun,runAutomationEvent,setAutomationRuleActive } from "@/lib/v220-repository";

async function get(){await requireApiCapability("automation.manage");return NextResponse.json(await loadAutomationWorkspace());}
async function post(request:Request){if(!mutationIsTrusted(request))throw new ApiError("UNTRUSTED_ORIGIN",403);await requireApiCapability("automation.manage");const parsed=automationInputSchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)throw new ApiError("INVALID_AUTOMATION_INPUT",400,"INVALID_AUTOMATION_INPUT",{field:String(parsed.error.issues[0]?.path[0]??"form")});let preview;if(parsed.data.operation==="create")await createAutomationRule(parsed.data);else if(parsed.data.operation==="toggle")await setAutomationRuleActive(parseUuid(parsed.data.id),parsed.data.active);else if(parsed.data.operation==="run")await runAutomationEvent({trigger:parsed.data.triggerKey,eventKey:parsed.data.eventKey,payload:parsed.data.payload});else if(parsed.data.operation==="preview")preview=await previewAutomationRule(parseUuid(parsed.data.id),parsed.data.payload);else await retryAutomationRun(parseUuid(parsed.data.id));return NextResponse.json({...await loadAutomationWorkspace(),preview});}
export const GET=apiRoute(get,"AUTOMATION_LOAD_FAILED");
export const POST=apiRoute(post,"AUTOMATION_OPERATION_FAILED");
