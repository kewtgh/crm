import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "@/lib/api";
import {listChannelEnrollmentSnapshots} from "@/lib/enrollment-repository";
async function get(request:Request) {
 await requireApiCapability("education.view");
 const parsed=z.object({productId:z.uuid().optional(),cohortId:z.uuid().optional(),page:z.coerce.number().int().min(1).max(100000).default(1)}).safeParse(Object.fromEntries(new URL(request.url).searchParams));
 if(!parsed.success)throw new ApiError("ENROLLMENT_INPUT_INVALID",400);
 return NextResponse.json({items:await listChannelEnrollmentSnapshots(parsed.data)});
}
export const GET=apiRoute(get,"ENROLLMENT_LOAD_FAILED");
