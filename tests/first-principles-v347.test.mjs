import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {privacyCommandSchema,privacyViewSchema,privacyPageSchema,privacyReceiptSchema,privacyNextStatuses} from '../lib/privacy-request-contract.ts';
import {executePrivacyCommand,listPrivacyRequests} from '../lib/privacy-request-repository.ts';
import {completedPeriods,completedSince} from '../lib/calendar-history.ts';
import {listAppointments,listCompletedAppointments} from '../lib/calendar-repository.ts';
import {appointmentCreateSchema} from '../lib/calendar-actions.ts';
import {calendarAgenda,calendarRelationKind} from '../lib/calendar-workspace.ts';
import {notificationHref} from '../lib/notification-link.ts';
import {privacyCalendarZh,privacyCalendarEn} from '../lib/i18n/locales/privacy-calendar.ts';
const id=()=>randomUUID();
test('privacy contracts reject hidden changes, unsupported filters, unsafe paging and incomplete review evidence',()=>{
 assert.equal(privacyViewSchema.parse({}).pageSize,20);
 for(const input of [{page:0},{pageSize:100},{scope:'other'},{due:'expired'},{status:'HIDDEN'},{unknown:'value'}])assert.equal(privacyViewSchema.safeParse(input).success,false);
 const create={operation:'create',type:'ACCESS',contactId:id(),note:'Fictional request note',changes:{},requestKey:id()};assert.ok(privacyCommandSchema.safeParse(create).success);
 for(const input of [{...create,changes:{title:'hidden'}},{...create,type:'CORRECTION'},{...create,extra:'private'},{...create,type:'CORRECTION',changes:{legalHold:true}},{...create,requestKey:'invalid'}])assert.equal(privacyCommandSchema.safeParse(input).success,false);
 assert.equal(privacyCommandSchema.safeParse({...create,type:'CORRECTION',changes:{email:''}}).success,true);
 assert.equal(privacyCommandSchema.safeParse({operation:'manage',id:id(),status:'FULFILLED',identityStatus:'VERIFIED',decision:'Fictional decision',requestKey:id()}).success,false);
 assert.deepEqual(privacyNextStatuses({status:'IN_PROGRESS',type:'DELETION'}),['WAITING_APPROVAL','REJECTED','CANCELLED']);assert.deepEqual(privacyNextStatuses({status:'EXECUTING',type:'EXPORT'}),[]);
});
test('privacy repository forwards one command identity and accepts only minimized receipts and complete pages',async()=>{
 const command={operation:'create',type:'ACCESS',contactId:id(),note:'Fictional repository note',requestKey:id()},receipt={id:id(),status:'RECEIVED',identityStatus:'PENDING',accepted:true};let sent;
 assert.deepEqual(await executePrivacyCommand(command,async(url,options)=>{sent={url,body:JSON.parse(options.body)};return {...receipt,private_detail:'discarded'};}),receipt);
 assert.equal(sent.url,'/db/rpc/privacy_request_command');assert.equal(sent.body.p_request_key,command.requestKey);assert.equal(sent.body.p_command.requestKey,undefined);
 await listPrivacyRequests({page:2,scope:'mine'},async(url,options)=>{assert.equal(url,'/db/rpc/list_privacy_requests');assert.equal(JSON.parse(options.body).p_page,2);return{items:[],total:20,page:2,pageSize:20};});
 assert.throws(()=>privacyReceiptSchema.parse({ok:true}));assert.throws(()=>privacyPageSchema.parse({items:[]}));
});
test('completed display cutoffs use account-local midnight, clamped calendar months and DST',()=>{
 assert.equal(completedPeriods.length,5);
 assert.equal(completedSince('1m','Asia/Taipei',new Date('2026-03-31T10:00:00Z')),'2026-02-27T16:00:00.000Z');
 assert.equal(completedSince('1y','Asia/Taipei',new Date('2024-02-29T10:00:00Z')),'2023-02-27T16:00:00.000Z');
 assert.equal(completedSince('1w','America/New_York',new Date('2026-03-12T12:00:00Z')),'2026-03-05T05:00:00.000Z');
});
test('calendar completed queries preserve scheduled capacity, completion cutoff and stable server paging',async()=>{
 const queries=[];const request=async(url,init)=>{queries.push({url,init});return new Response('[]',{headers:{'content-range':'0-0/0'}});};
 await listAppointments('2026-10-01T00:00:00Z','2026-12-01T00:00:00Z','Asia/Taipei',{request,json:async()=>[],includeCompleted:true,period:'6m',now:new Date('2026-10-26T00:00:00Z')});
 assert.equal(queries.length,2);assert.match(queries[0].url,/status=eq.SCHEDULED/);const params=new URL(queries[1].url,'http://example.test').searchParams;assert.equal(params.get('status'),'eq.COMPLETED');assert.equal(params.getAll('completed_at').length,2);assert.equal(params.getAll('starts_at').length,2);assert.equal(queries[0].init.headers.Range,'0-499');
 await listCompletedAppointments('1w',3,20,'Asia/Taipei',request,new Date('2026-10-26T00:00:00Z'));assert.equal(queries[2].init.headers.Range,'40-59');assert.equal(new URL(queries[2].url,'http://example.test').searchParams.get('order'),'completed_at.desc,id.desc');assert.equal(new URL(queries[2].url,'http://example.test').searchParams.has('starts_at'),false);
});
test('calendar mapping identifies invitations, keeps completed events out of upcoming and separates relation types',async()=>{
 const viewer=id(),event=id();const row={id:event,title_zh:'示例邀请',title_en:'Fictional invitation',appointment_type:'MEETING',related_label:'Fictional member',starts_at:'2026-10-26T10:00:00Z',channel:'Office',reminder_minutes:[30],related_type:'USER',related_id:viewer,created_by:id(),status:'COMPLETED',completed_at:'2026-10-26T11:00:00Z',event_version:2};
 const result=await listCompletedAppointments('3m',1,20,'Asia/Taipei',async()=>new Response(JSON.stringify([row])),new Date('2026-10-27'),viewer);assert.equal(result.items[0].incoming,true);assert.equal(calendarRelationKind(result.items[0]),'invited');
 assert.equal(calendarAgenda(result.items,'upcoming','2026-10-01','2026-10-26').length,0);assert.equal(calendarAgenda(result.items,'day','2026-10-01','2026-10-26').length,1);
 assert.equal(calendarRelationKind({relationType:'USER'}),'member');assert.equal(calendarRelationKind({relationType:'CONTACT'}),'contact');assert.equal(calendarRelationKind({relationType:'ORGANIZATION'}),'organization');
 assert.equal(notificationHref({sourceType:'APPOINTMENT',sourceId:event}),'/calendar?event='+event);
 const input={title:'Fictional invitation',locale:'en',date:'2026-10-26',time:'22:15',type:'meeting',channel:'Office',related:'Fictional member',relatedType:'USER',relatedId:viewer,reminder:30,requestKey:id()};assert.ok(appointmentCreateSchema.safeParse(input).success);assert.equal(appointmentCreateSchema.safeParse({...input,relatedId:null}).success,false);
});
test('new privacy and calendar copy has bilingual key and placeholder parity',()=>{assert.deepEqual(Object.keys(privacyCalendarZh).sort(),Object.keys(privacyCalendarEn).sort());for(const key of Object.keys(privacyCalendarZh))assert.deepEqual(privacyCalendarZh[key].match(/\{\w+\}/g)??[],privacyCalendarEn[key].match(/\{\w+\}/g)??[],key);});
test('actual privacy API enforces session, MFA, origin, view validation and snapshot conflict responses',async()=>{
 await mkdir('work/v347-contract',{recursive:true});
 const stubs={auth:`export const getCurrentUser=async()=>globalThis.__privacyApi.user;`,observability:`export const emitObservabilityEvent=async()=>{};export const requestOutcome=()=> 'success';export const routeTemplate=x=>x;`,'request-security':`export const mutationIsTrusted=()=>globalThis.__privacyApi.trusted;`,'privacy-request-repository':`export const listPrivacyRequests=async()=>({items:[],total:0,page:1,pageSize:20});export const executePrivacyCommand=async()=>{globalThis.__privacyApi.writes++;if(globalThis.__privacyApi.error)throw globalThis.__privacyApi.error;return globalThis.__privacyApi.receipt;};`};
 await build({stdin:{contents:`export {GET,POST} from './app/api/privacy-requests/route';export {DatabaseRequestError} from './lib/db/gateway';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',packages:'external',outfile:'work/v347-contract/routes.cjs',plugins:[{name:'privacy-adapters',setup(b){b.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(key=>args.path==='@/lib/'+key||args.path==='./'+key);return key?{path:key,namespace:'privacy'}:null;});b.onLoad({filter:/.*/,namespace:'privacy'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 const {GET,POST,DatabaseRequestError}=createRequire(import.meta.url)('../work/v347-contract/routes.cjs');const state=globalThis.__privacyApi={user:null,trusted:true,writes:0,receipt:{id:id(),status:'RECEIVED',identityStatus:'PENDING',accepted:true}};
 const read=path=>GET(new Request('http://example.test/api/privacy-requests'+path));const command={operation:'create',type:'ACCESS',contactId:id(),note:'Fictional API evidence',requestKey:id()},post=input=>POST(new Request('http://example.test/api/privacy-requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}));
 try{assert.equal((await read('')).status,401);state.user={id:id(),role:'ADMIN',aal:'aal2',mustChangePassword:false};assert.equal((await read('?page=0')).status,400);assert.equal((await read('?scope=mine&scope=all')).status,400);assert.equal((await read('')).headers.get('cache-control'),'private, no-store');state.trusted=false;assert.equal((await post(command)).status,403);assert.equal(state.writes,0);state.trusted=true;assert.equal((await post(command)).status,201);state.user.aal='aal1';assert.equal((await post({operation:'manage',id:id(),reviewToken:'a'.repeat(64),status:'IDENTITY_REVIEW',identityStatus:'PENDING',decision:'Fictional review',requestKey:id()})).status,403);assert.equal(state.writes,1);state.user.aal="aal2";state.error=new DatabaseRequestError(400,"PRIVACY_SNAPSHOT_CONFLICT","Fictional stale snapshot");assert.equal((await post(command)).status,409);}finally{delete globalThis.__privacyApi;}
});
