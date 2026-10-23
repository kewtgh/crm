import { NextResponse } from "next/server";
import { listGeneratedJobs } from "@/lib/generated-jobs-repository";
import { ApiError, apiRoute, parsePagination, requireApiUser } from "@/lib/api";
import { exportStatusValid } from "@/lib/export-job-state";

async function get(request:Request){await requireApiUser();const params=new URL(request.url).searchParams;const{page,pageSize}=parsePagination(params,10);const status=params.get("status")??"all";if(!exportStatusValid(status))throw new ApiError("INVALID_EXPORT_STATUS",400);return NextResponse.json(await listGeneratedJobs({query:params.get("q")??"",status,page,pageSize}));}
export const GET=apiRoute(get,"EXPORTS_LOAD_FAILED");
