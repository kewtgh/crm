import {NextResponse} from 'next/server';
import {z} from 'zod';
import {apiRoute,ApiError,requireApiCapability,requireApiAal2,requireApiRole} from '@/lib/api';
import {databaseJson} from '@/lib/db/gateway';
import {mutationIsTrusted} from '@/lib/request-security';
const reference=z.string().trim().min(1).max(200);
const schema=z.discriminatedUnion('command',[
 z.object({command:z.enum(['PROFILE_SUBMIT','PROFILE_APPROVE']),entity:z.uuid(),requestKey:z.string().min(8).max(120),data:z.object({revision:z.number().int().positive(),reference}).strict()}),
 z.object({command:z.literal('PROFILE_CREATE'),entity:z.uuid(),requestKey:z.string().min(8).max(120),data:z.object({owner:z.uuid(),approver:z.uuid(),profile:z.object({legal_name:reference,accounting_framework:reference,business_timezone:reference,allowed_currencies:z.array(z.string().regex(/^[A-Z]{3}$/)).min(1).max(10),cutoff_reference:reference,correction_reference:reference,retention_reference:reference,authority_reference:reference}).strict()}).strict()}),
 z.object({command:z.literal('PERIOD_CREATE'),entity:z.uuid(),requestKey:z.string().min(8).max(120),data:z.object({period_key:reference,start_on:z.iso.date(),end_on:z.iso.date()}).strict()})
]);
async function get(){await requireApiCapability('revenue.configuration.view');return NextResponse.json(await databaseJson('/db/rpc/revenue_admin_configuration_read',{method:'POST',body:'{}'}));}
async function post(request:Request){if(!mutationIsTrusted(request))throw new ApiError('UNTRUSTED_ORIGIN',403);await requireApiCapability('revenue.configuration.manage');await requireApiAal2();await requireApiRole('ADMIN','SUPER_ADMIN');const parsed=schema.safeParse(await request.json());if(!parsed.success)throw new ApiError('REVENUE_INPUT_INVALID',400);const {command,entity,data,requestKey}=parsed.data;const item=await databaseJson('/db/rpc/revenue_admin_configuration_command',{method:'POST',body:JSON.stringify({command,entity,data,request_key:requestKey})});return NextResponse.json({accepted:true,item});}
export const GET=apiRoute(get,'REVENUE_LOAD_FAILED');
export const POST=apiRoute(post,'REVENUE_OPERATION_FAILED');
