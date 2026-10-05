import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiRoute,ApiError,parseUuid,requireApiCapability} from '@/lib/api';
import {uploadRpc} from '@/lib/contract-upload-repository';
async function post(request:Request,{params}:{params:Promise<{id:string}>}){await requireApiCapability('contracts.manage');const data=z.object({forceNew:z.boolean().default(false)}).strict().safeParse(await request.json().catch(()=>null));if(!data.success)throw new ApiError('UPLOAD_INPUT_INVALID',400);return NextResponse.json({runId:await uploadRpc('queue_contract_extraction',{record_id:parseUuid((await params).id),force_new:data.data.forceNew})},{status:202});}
export const POST=apiRoute(post,'UPLOAD_EXTRACTION_FAILED');
