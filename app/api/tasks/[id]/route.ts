import { NextResponse } from "next/server";
import { apiRoute, parseUuid, requireApiCapability } from "@/lib/api";
import { completeDashboardTask } from "@/lib/dashboard-repository";
import { mutationIsTrusted } from "@/lib/request-security";
import { DatabaseRequestError } from "@/lib/db/gateway";
import {taskCompletionSchema} from "@/lib/task-completion";
async function patch(request:Request,context:{params:Promise<{id:string}>}){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireApiCapability("tasks.manage");const id=parseUuid((await context.params).id);const parsed=taskCompletionSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success||parsed.data.operation!=="complete"||parsed.data.tasks[0].id.toLowerCase()!==id.toLowerCase())return NextResponse.json({code:"INVALID_TASK_OPERATION"},{status:400});try{return NextResponse.json(await completeDashboardTask(id,parsed.data.tasks[0].expectedRevision,parsed.data.requestKey));}catch(error){return error instanceof DatabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"TASK_UPDATE_FAILED"},{status:500});}}
export const PATCH=apiRoute(patch,"TASK_UPDATE_FAILED");
