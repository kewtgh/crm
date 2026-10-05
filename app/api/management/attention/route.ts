import {NextResponse} from "next/server";
import {ApiError,apiRoute,requireApiCapability} from "@/lib/api";
import {attentionFiltersSchema} from "@/lib/management-attention-contract";
import {getManagementAttention} from "@/lib/management-attention-repository";
export const GET=apiRoute(async(request:Request)=>{await requireApiCapability("education.view");const parsed=attentionFiltersSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));if(!parsed.success)throw new ApiError("MANAGEMENT_INPUT_INVALID",400);return NextResponse.json(await getManagementAttention(parsed.data),{headers:{"cache-control":"no-store"}});},"MANAGEMENT_LOAD_FAILED");
