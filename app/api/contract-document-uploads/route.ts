import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiRoute,ApiError,parseUuid,requireApiCapability} from '@/lib/api';
import {storeContractUpload,uploadRpc,UploadedRecord} from '@/lib/contract-upload-repository';
import {boundedUploadForm} from '@/lib/contract-upload-input.mjs';
import {DocumentError} from '@/lib/contract-document-engine.mjs';
const kind=z.enum(['CUSTOMER_CONTRACT','CHANNEL_AGREEMENT_VERSION']);
const schema=z.object({sourceKind:kind,sourceId:z.uuid(),expectedRevision:z.number().int().positive(),requestKey:z.string().min(8).max(160),context:z.object({enrollmentId:z.uuid().optional(),productId:z.uuid().optional(),cohortId:z.uuid().optional(),commissionRuleId:z.uuid().optional()}).strict()}).strict();
async function get(request:Request){await requireApiCapability('contracts.view');const q=new URL(request.url).searchParams,k=kind.safeParse(q.get('sourceKind'));if(!k.success)throw new ApiError('UPLOAD_INPUT_INVALID',400);return NextResponse.json({items:await uploadRpc<UploadedRecord[]>('uploaded_documents_list',{kind:k.data,source:parseUuid(q.get('sourceId')??'')})});}
async function post(request:Request){await requireApiCapability('contracts.manage');try{const form=await boundedUploadForm(request),file=form.get('file'),input=schema.safeParse(JSON.parse(String(form.get('input'))));if(!input.success||!(file instanceof File)||[...form.keys()].some(k=>!['file','input'].includes(k))||form.getAll('file').length!==1||form.getAll('input').length!==1)throw new ApiError('UPLOAD_INPUT_INVALID',400);return NextResponse.json(await storeContractUpload(input.data,file),{status:202});}catch(error){if(error instanceof DocumentError)throw new ApiError(error.code,400);if(error instanceof SyntaxError)throw new ApiError('UPLOAD_INPUT_INVALID',400);throw error;}}
export const GET=apiRoute(get,'UPLOAD_LIST_FAILED');
export const POST=apiRoute(post,'UPLOAD_FAILED');
