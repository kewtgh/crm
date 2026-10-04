import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "@/lib/api";
import {getEnrollment} from "@/lib/enrollment-repository";
import {listAdmissionsTimeline} from "@/lib/admission-milestone-repository";
async function get(request:Request,context:{params:Promise<{id:string}>}){
 await requireApiCapability("education.view");const id=z.uuid().safeParse((await context.params).id),params=new URL(request.url).searchParams,query=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20)}).safeParse(Object.fromEntries(params));
 if(!id.success||!query.success)throw new ApiError("MILESTONE_INPUT_INVALID",400);if(!await getEnrollment(id.data))throw new ApiError("MILESTONE_ENROLLMENT_NOT_FOUND",404);
 return NextResponse.json(await listAdmissionsTimeline(id.data,query.data.page,query.data.pageSize));
}
export const GET=apiRoute(get,"MILESTONE_LOAD_FAILED");
