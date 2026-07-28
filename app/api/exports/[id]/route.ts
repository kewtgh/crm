import { NextResponse } from "next/server";
import { getGeneratedJob, signGeneratedJob } from "@/lib/generated-jobs-repository";
import { DatabaseRequestError } from "@/lib/db/gateway";
import { apiRoute, parseUuid, requireApiUser } from "@/lib/api";

async function get(_:Request,{params}:{params:Promise<{id:string}>}){await requireApiUser();try{const{id:rawId}=await params;const id=parseUuid(rawId);const job=await getGeneratedJob(id);if(!job)return NextResponse.json({code:"EXPORT_NOT_FOUND"},{status:404});if(job.status!=="READY"||!job.artifact_path||!job.expires_at||new Date(job.expires_at)<=new Date())return NextResponse.json({code:"EXPORT_NOT_READY"},{status:409});const signed=await signGeneratedJob(job.artifact_path);if(!signed.signedURL)return NextResponse.json({code:"EXPORT_SIGN_FAILED"},{status:503});return NextResponse.redirect(new URL(signed.signedURL,process.env.APP_URL??"http://localhost:3200"),303);}catch(error){return error instanceof DatabaseRequestError?NextResponse.json({code:error.code},{status:error.status}):NextResponse.json({code:"EXPORT_DOWNLOAD_FAILED"},{status:500});}}
export const GET=apiRoute(get,"EXPORT_DOWNLOAD_FAILED");
