import {NextResponse} from "next/server";
import {z} from "zod";
import {ApiError,apiRoute,requireApiCapability} from "@/lib/api";
import {getEnrollment,getEnrollmentFinanceProjection} from "@/lib/enrollment-repository";
async function get(_request:Request, context:{params:Promise<{id:string}>}) {
  await requireApiCapability("education.view");
  await requireApiCapability("finance.view");
  const parsed=z.uuid().safeParse((await context.params).id);
  if(!parsed.success)throw new ApiError("ENROLLMENT_INPUT_INVALID",400);
  if(!await getEnrollment(parsed.data))throw new ApiError("ENROLLMENT_NOT_FOUND",404);
  return NextResponse.json({item:await getEnrollmentFinanceProjection(parsed.data)});
}
export const GET=apiRoute(get,"FINANCE_LOAD_FAILED");
