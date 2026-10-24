import { NextResponse } from "next/server";
import { apiRoute, requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { executeTaskCompletion, loadTaskWorkspace } from "@/lib/task-workspace-repository";
import {taskCompletionSchema as schema} from "@/lib/task-completion";

async function get(){await requireApiCapability("tasks.view");return NextResponse.json(await loadTaskWorkspace());}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireApiCapability("tasks.manage");const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_TASK_OPERATION"},{status:400});return NextResponse.json(await executeTaskCompletion(parsed.data));}
export const GET=apiRoute(get,"TASK_WORKSPACE_LOAD_FAILED");
export const POST=apiRoute(post,"TASK_BULK_UPDATE_FAILED");
