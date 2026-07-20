import { NextResponse } from "next/server";
import { z } from "zod";
import { apiRoute, requireApiCapability } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import { bulkCompleteTasks, loadTaskWorkspace } from "@/lib/task-workspace-repository";

const schema=z.object({operation:z.literal("bulkComplete"),ids:z.array(z.string().uuid()).min(1).max(50),reason:z.string().trim().min(3).max(500)});
async function get(){await requireApiCapability("tasks.view");return NextResponse.json(await loadTaskWorkspace());}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:"UNTRUSTED_ORIGIN"},{status:403});await requireApiCapability("tasks.manage");const parsed=schema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:"INVALID_TASK_OPERATION"},{status:400});return NextResponse.json({affected:await bulkCompleteTasks(parsed.data.ids,parsed.data.reason)});}
export const GET=apiRoute(get,"TASK_WORKSPACE_LOAD_FAILED");
export const POST=apiRoute(post,"TASK_BULK_UPDATE_FAILED");
