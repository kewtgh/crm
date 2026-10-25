import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {communicationDefaults,communicationViewSchema,readCommunicationView,writeCommunicationView,communicationCommandSchema,communicationResultSchema,communicationThreadSchema} from '../lib/communications-contract.ts';
import {communicationsRecoveryZh,communicationsRecoveryEn} from '../lib/i18n/locales/communications-recovery.ts';

const id='00000000-0000-4000-8000-000000000011',messageId='00000000-0000-4000-8000-000000000012',stamp='2026-10-25T01:02:03.123456+00:00';
test('communication URL views preserve conversation, external context and multiword typing',()=>{
 for(const status of ['all','OPEN','CLOSED'])for(const purpose of ['all','SERVICE','TRANSACTIONAL','EVENT','MARKETING'])for(const delivery of ['all','pending','failed','uncertain']){
  const view={...communicationDefaults,q:'Fictional service ',status,purpose,delivery,thread:id,page:3,pageSize:10},params=new URLSearchParams('context=fictional&tab=inbox');
  assert.deepEqual(readCommunicationView(writeCommunicationView(params,view)),view);assert.equal(writeCommunicationView(params,view).get('context'),'fictional');assert.equal(params.has('thread'),false);
 }
 assert.deepEqual(readCommunicationView(new URLSearchParams('status=constructor&purpose=unknown&delivery=sent&page=0&pageSize=100&thread=invalid')),communicationDefaults);
 assert.equal(writeCommunicationView(new URLSearchParams(),communicationDefaults).toString(),'');
 for(const patch of [{page:1.2},{page:100001},{q:'x'.repeat(161)},{pageSize:21},{status:'ARCHIVED'},{unexpected:true}])assert.equal(communicationViewSchema.safeParse({...communicationDefaults,...patch}).success,false);
});
test('redelivery requires the exact observed failure and a durable request key',()=>{
 const retry={operation:'retry',messageId,expectedUpdatedAt:stamp,requestKey:'fictional-request-key'};
 assert.equal(communicationCommandSchema.parse(retry).expectedUpdatedAt,stamp);
 for(const patch of [{expectedUpdatedAt:undefined},{expectedUpdatedAt:'2026-10-25'},{requestKey:undefined},{messageId:'bad'},{extra:true}])assert.equal(communicationCommandSchema.safeParse({...retry,...patch}).success,false);
 assert.equal(communicationCommandSchema.safeParse({operation:'send',threadId:id,body:' ',idempotencyKey:'fictional-key'}).success,false);
 assert.equal(communicationCommandSchema.safeParse({operation:'thread',contactId:id,subject:'Fictional service',channel:'SMS',purpose:'SERVICE',requestKey:'fictional-key'}).success,false);
});
test('successful communication responses must contain the operation identity and message outcome',()=>{
 assert.equal(communicationResultSchema.safeParse({operation:'send',threadId:id,messageId,deliveryStatus:'QUEUED',accepted:true}).success,true);
 for(const value of [{ok:true},{operation:'send',threadId:id},{operation:'retry',threadId:id,messageId},{operation:'send',threadId:id,messageId,deliveryStatus:'QUEUED',accepted:false},{operation:'thread',threadId:'invalid'}])assert.equal(communicationResultSchema.safeParse(value).success,false);
 const summary={id,contactId:id,contactZh:'示例联系人',contactEn:'Fictional Contact',email:'recipient@example.test',subject:'Fictional service',channel:'EMAIL',purpose:'SERVICE',status:'OPEN',lastMessageAt:null,messageTotal:1,messagePage:1,messagePageSize:20};
 const message={id:messageId,direction:'OUTBOUND',body:'Fictional update',deliveryStatus:'FAILED',failureCode:'PROVIDER_REJECTED',retryAllowed:true,retryToken:stamp,attemptCount:1,providerAttemptCount:1,createdAt:stamp};
 assert.equal(communicationThreadSchema.safeParse({...summary,messages:[message]}).success,true);
 assert.equal(communicationThreadSchema.safeParse({...summary,messages:[{...message,retryToken:undefined}]}).success,false);
});
test('communication recovery copy distinguishes acceptance, delivery, memory drafts and uncertain outcomes',()=>{
 assert.deepEqual(Object.keys(communicationsRecoveryEn).sort(),Object.keys(communicationsRecoveryZh).sort());
 assert.match(communicationsRecoveryEn['commsRecovery.accepted'],/actual delivery status/);
 assert.match(communicationsRecoveryEn['commsRecovery.draftHelp'],/not retained after leaving/);
 assert.match(communicationsRecoveryEn['commsRecovery.uncertain'],/original request/);
});
test('communication pane ownership invalidates reads and keeps drafts outside browser storage',async()=>{
 const hook=await readFile(new URL('../hooks/use-communications-workspace.ts',import.meta.url),'utf8'),component=await readFile(new URL('../components/communications-inbox-page.tsx',import.meta.url),'utf8');
 assert.match(hook,/cancelList\(\);cancelThread\(\)/);assert.match(hook,/selectedIdRef.current!==id/);
 assert.match(hook,/original.current=JSON.stringify\(parsed.data\)/);assert.match(hook,/!unknownOutcome.current/);
 assert.match(component,/useCapability\("messages.manage"\)/);assert.match(component,/drafts\[selectedId\]/);
 assert.doesNotMatch(component,/localStorage|sessionStorage/);
});
test('communication route enforces actual capability, validates inputs and dispatches only atomic commands',async context=>{
 const output=path.resolve('work/communications-contract/route.cjs');await mkdir(path.dirname(output),{recursive:true});
 const stubs={
  auth:`export const getCurrentUser=async()=>globalThis.__commsTest.user;`,
  'db/gateway':`export class DatabaseRequestError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}};export const databaseJson=async(url,init)=>globalThis.__commsTest.query(url,init);export const databaseSystemJson=databaseJson;export const databaseRequest=databaseJson;`,
  observability:`export const emitObservabilityEvent=async()=>{};export const requestOutcome=()=> 'success';export const routeTemplate=value=>value;`,
 };
 await build({stdin:{contents:`export {GET,POST} from './app/api/communications/route';export {DatabaseRequestError} from './lib/db/gateway';`,resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'communication-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(key=>args.path===key||args.path.endsWith('/'+key));return key?{path:key,namespace:'communication-stub'}:undefined;});builder.onLoad({filter:/.*/,namespace:'communication-stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 const runtime=createRequire(import.meta.url)(output),previous=process.env.APP_URL;process.env.APP_URL='http://localhost:3200';
 const h=globalThis.__commsTest={user:{id,role:'SALES_SPECIALIST',aal:'aal2'},calls:[],query:async(url,init)=>{h.calls.push({url,body:JSON.parse(init.body)});return {operation:'send',threadId:id,messageId,deliveryStatus:'QUEUED',accepted:true};}};
 context.after(async()=>{delete globalThis.__commsTest;if(previous===undefined)delete process.env.APP_URL;else process.env.APP_URL=previous;await rm(output,{force:true});});
 const request=(body,origin='http://localhost:3200')=>new Request('http://localhost:3200/api/communications',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
 const payload={operation:'send',threadId:id,body:'Fictional service update',idempotencyKey:'fictional-operation-key'};
 await context.test('accepted sending writes a receipt envelope and returns 202',async()=>{
  const response=await runtime.POST(request(payload));assert.equal(response.status,202);assert.equal((await response.json()).deliveryStatus,'QUEUED');
  assert.deepEqual(h.calls.at(-1),{url:'/db/rpc/communication_workspace_command',body:{p_command:{operation:'send',threadId:id,body:payload.body},p_request_key:payload.idempotencyKey}});
 });
 await context.test('view-only roles can read but never dispatch a write',async()=>{
  for(const role of ['OPERATIONS_MANAGER','CUSTOMER_SUCCESS_SPECIALIST']){h.user.role=role;const before=h.calls.length;assert.equal((await runtime.POST(request(payload))).status,403);assert.equal(h.calls.length,before);assert.equal((await runtime.GET(new Request('http://localhost:3200/api/communications'))).status,200);assert.equal(h.calls.length,before+1);}
  h.user.role='SALES_SPECIALIST';
 });
 await context.test('untrusted requests and unversioned retries are rejected before persistence',async()=>{
  const before=h.calls.length;assert.equal((await runtime.POST(request(payload,'https://untrusted.example.test'))).status,403);
  for(const body of [{operation:'retry',messageId}, {...payload,unexpected:true},{...payload,body:' '}])assert.equal((await runtime.POST(request(body))).status,400);
  assert.equal(h.calls.length,before);
 });
 await context.test('inbox validates all filters and forwards server pagination',async()=>{
  const response=await runtime.GET(new Request('http://localhost:3200/api/communications?q=Fictional&status=CLOSED&purpose=EVENT&delivery=failed&page=2&pageSize=10'));
  assert.equal(response.status,200);assert.deepEqual(h.calls.at(-1).body,{p_query:'Fictional',p_status:'CLOSED',p_purpose:'EVENT',p_delivery:'failed',p_page:2,p_page_size:10});
  for(const query of ['page=0','pageSize=99','status=UNKNOWN','delivery=sent','unexpected=true'])assert.equal((await runtime.GET(new Request('http://localhost:3200/api/communications?'+query))).status,400);
 });
 await context.test('stale failure tokens and permission errors have bounded status codes',async()=>{
  for(const [code,status] of [['COMMUNICATION_VERSION_CONFLICT',409],['COMMUNICATION_REQUEST_CONFLICT',409],['COMMUNICATION_ACCESS_DENIED',403],['COMMUNICATION_CONSENT_REQUIRED',400]]){
   h.query=async()=>{throw new runtime.DatabaseRequestError(500,code,'Fictional internal detail');};const response=await runtime.POST(request(payload));assert.equal(response.status,status);const body=await response.json();assert.equal(body.code,code);assert.ok(!JSON.stringify(body).includes('Fictional internal detail'));
  }
 });
});
