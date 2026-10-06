import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiRoute,requireApiCapability} from '@/lib/api';
import {mutationIsTrusted} from '@/lib/request-security';
import {setActionSchema} from '@/lib/import-set-contract';
import {loadImportSets,importSetAction,importSetError} from '@/lib/import-set-repository';
async function get(request:Request){await requireApiCapability('imports.execute');const id=new URL(request.url).searchParams.get('set');if(id&&!z.uuid().safeParse(id).success)return NextResponse.json({code:'INVALID_REFERENCE'},{status:400});try{return NextResponse.json(id?{item:await loadImportSets(id)}:{items:await loadImportSets()});}catch(e){return NextResponse.json({code:importSetError(e)},{status:404});}}
async function post(request:Request){if(!mutationIsTrusted(request))return NextResponse.json({code:'UNTRUSTED_ORIGIN'},{status:403});await requireApiCapability('imports.execute');const parsed=setActionSchema.safeParse(await request.json().catch(()=>({})));if(!parsed.success)return NextResponse.json({code:'INVALID_IMPORT_INPUT'},{status:400});try{return NextResponse.json({item:await importSetAction(parsed.data)});}catch(e){return NextResponse.json({code:importSetError(e)},{status:409});}}
export const GET=apiRoute(get,'IMPORT_SET_FAILED');export const POST=apiRoute(post,'IMPORT_SET_FAILED');
