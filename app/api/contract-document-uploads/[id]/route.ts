import {NextResponse} from 'next/server';
import {apiRoute,parseUuid,requireApiCapability} from '@/lib/api';
import {uploadRpc} from '@/lib/contract-upload-repository';
async function get(request:Request,{params}:{params:Promise<{id:string}>}){await requireApiCapability('contracts.view');return NextResponse.json(await uploadRpc('uploaded_document_detail',{record_id:parseUuid((await params).id),reveal:new URL(request.url).searchParams.get('reveal')==='true'}));}
export const GET=apiRoute(get,'UPLOAD_DETAIL_FAILED');
