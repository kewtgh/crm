import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiRoute,requireApiCapability} from '@/lib/api';
import {mutationIsTrusted} from '@/lib/request-security';
import {databaseJson} from '@/lib/db/gateway';
const kind=z.enum(['ORGANIZATION','HOUSEHOLD','CONTACT','STUDENT','PRODUCT','COHORT','STAFF','OPPORTUNITY']);
async function get(request:Request){
 await requireApiCapability('imports.execute');const url=new URL(request.url),parsed=kind.safeParse(url.searchParams.get('kind'));
 if(!parsed.success)return NextResponse.json({code:'INVALID_REFERENCE'},{status:400});
 return NextResponse.json({items:await databaseJson('/db/rpc/search_import_references',{method:'POST',body:JSON.stringify({kind:parsed.data,query:(url.searchParams.get('q')??'').slice(0,120)})})});
}
async function post(request:Request){
 if(!mutationIsTrusted(request))return NextResponse.json({code:'UNTRUSTED_ORIGIN'},{status:403});
 await requireApiCapability('imports.execute');const parsed=z.object({kind,recordId:z.uuid()}).strict().safeParse(await request.json().catch(()=>({})));
 if(!parsed.success)return NextResponse.json({code:'INVALID_REFERENCE'},{status:400});
 try{return NextResponse.json({token:await databaseJson('/db/rpc/issue_import_reference',{method:'POST',body:JSON.stringify({kind:parsed.data.kind,record_id:parsed.data.recordId})})});}
 catch{return NextResponse.json({code:'INVALID_REFERENCE'},{status:409});}
}
export const GET=apiRoute(get,'INVALID_REFERENCE');export const POST=apiRoute(post,'INVALID_REFERENCE');
