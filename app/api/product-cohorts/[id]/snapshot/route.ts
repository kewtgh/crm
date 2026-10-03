import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "@/lib/api";
import {getCohortEnrollmentSnapshot} from "@/lib/cohort-repository";
async function get(_request:Request,context:{params:Promise<{id:string}>}) {
 await requireApiCapability("education.view");
 const parsed=z.uuid().safeParse((await context.params).id);if(!parsed.success)throw new ApiError("COHORT_INPUT_INVALID",400);
 const item=await getCohortEnrollmentSnapshot(parsed.data);if(!item)throw new ApiError("COHORT_NOT_FOUND",404);
 return NextResponse.json({item});
}
export const GET=apiRoute(get,"COHORT_LOAD_FAILED");
