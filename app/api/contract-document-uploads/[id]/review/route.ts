import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiRoute,ApiError,parseUuid,requireApiCapability} from '@/lib/api';
import {uploadRpc} from '@/lib/contract-upload-repository';
const schema=z.object({runId:z.uuid(),candidateKey:z.string().min(1).max(160),decision:z.enum(['CONFIRMED','REJECTED','EDITED','DEFERRED']),confirmedValue:z.union([z.string().max(5000),z.boolean(),z.null()]),expectedRevision:z.number().int().positive(),expectedSourceRevision:z.number().int().positive(),requestKey:z.string().min(8).max(160),reason:z.string().max(500).default('')}).strict();
async function post(request:Request,{params}:{params:Promise<{id:string}>}){await requireApiCapability('contracts.manage');const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw new ApiError('UPLOAD_INPUT_INVALID',400);const d=parsed.data;return NextResponse.json({id:await uploadRpc('review_uploaded_candidate',{record_id:parseUuid((await params).id),run_id:d.runId,candidate_key:d.candidateKey,decision:d.decision,confirmed_value:d.confirmedValue===null?null:JSON.stringify(d.confirmedValue),expected_revision:d.expectedRevision,expected_source_revision:d.expectedSourceRevision,p_request_key:d.requestKey,reason:d.reason})});}
export const POST=apiRoute(post,'UPLOAD_REVIEW_FAILED');
