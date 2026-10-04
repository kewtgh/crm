import {NextResponse} from "next/server";
import {apiRoute,ApiError,requireApiCapability} from "@/lib/api";
import {successAnalyticsFiltersSchema} from "@/lib/student-success-outcomes-input";
import {getSuccessAnalytics} from "@/lib/student-success-analytics-repository";
export const GET=apiRoute(async(request:Request)=>{await requireApiCapability("education.view");const parsed=successAnalyticsFiltersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)throw new ApiError("SUCCESS_INPUT_INVALID",400);return NextResponse.json(await getSuccessAnalytics(parsed.data));},"SUCCESS_LOAD_FAILED");
