import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {approvalDefaults,approvalDatabaseTypes,approvalTypes,approvalQuerySchema,readApprovalQuery,writeApprovalQuery,approvalTypeKey,approvalDecisionSchema,approvalDecisionResultSchema,approvalIsActionable,approvalDisplayStatus} from '../lib/approval-contract.ts';
import {listApprovals,decideApproval} from '../lib/governance-repository.ts';
import {approvalReviewZh,approvalReviewEn} from '../lib/i18n/locales/approval-review.ts';

const id='00000000-0000-4000-8000-000000000011',actor='00000000-0000-4000-8000-000000000099',stamp='2026-10-25T01:02:03.123456+00:00',reviewToken='a'.repeat(64);
const row={id,requesterId:actor,requestNumber:'EX-REVIEW-1',requestType:'PERFORMANCE_SUMMARY',object:'FICTIONAL_CONTEXT · '+id,requester:'Fictional Advisor',submitted:stamp,expiresAt:'2099-01-01T00:00:00Z',level:'admin',reason:'Fictional review request',status:'pending',executionStatus:'NOT_STARTED',decisionReason:null,decidedAt:null,reviewToken,canDecide:true};
const page=(items=[row])=>({items,total:items.length,page:1,pageSize:10,asOf:stamp,summary:{pending:items.length,approved:0,rejected:0,cancelled:0,expired:0,failedExecution:0,highPrivilegePending:0}});
const command={decision:'APPROVED',comment:'Fictional review',expectedReviewToken:reviewToken,requestKey:'fictional-review-key'};

test('approval URLs retain exact filter text, personal scope, history context and supported paging',()=>{
 for(const type of ['all',...approvalTypes])for(const scope of ['all','mine','reviewable']){
  const query={...approvalDefaults,type,scope,status:'all',execution:'FAILED',q:'Fictional review ',page:3,pageSize:20},original=new URLSearchParams('context=fictional');
  assert.deepEqual(readApprovalQuery(writeApprovalQuery(original,query)),query);assert.equal(writeApprovalQuery(original,query).get('context'),'fictional');assert.equal(original.has('type'),false);
 }
 assert.equal(writeApprovalQuery(new URLSearchParams(),approvalDefaults).toString(),'');
 assert.deepEqual(readApprovalQuery(new URLSearchParams('type=constructor&scope=workspace&status=lost&execution=deleted&page=-1&pageSize=100')),approvalDefaults);
 for(const patch of [{q:'x'.repeat(101)},{page:1.5},{page:100001},{pageSize:13},{unexpected:true}])assert.equal(approvalQuerySchema.safeParse({...approvalDefaults,...patch}).success,false);
});
test('the approval catalog keeps every existing revenue type and never mislabels unknown types',()=>{
 for(const [key,value] of Object.entries(approvalDatabaseTypes))assert.equal(approvalTypeKey(value),key);
 assert.equal(approvalTypeKey('FUTURE_APPROVAL_KIND'),'other');assert.equal(approvalTypeKey('constructor'),'other');
 for(const type of approvalTypes)assert.ok(type==='other'||Object.hasOwn(approvalDatabaseTypes,type));
});
test('read projection validates full results and forwards all authorized server filters',async()=>{
 const result=await listApprovals({q:'Fictional,(review)',type:'revenuePolicyVersion',status:'expired',scope:'mine',execution:'FAILED'},async(url,init)=>{
  assert.equal(url,'/db/rpc/query_approval_workspace');assert.deepEqual(JSON.parse(init.body),{p_query:'Fictional,(review)',p_type:'REVENUE_POLICY_VERSION',p_status:'expired',p_scope:'mine',p_execution:'FAILED',p_page:1,p_page_size:10});
  return page([{...row,requestType:'REVENUE_POLICY_VERSION',canDecide:false}]);
 });
 assert.equal(result.items[0].type,'revenuePolicyVersion');assert.equal(result.items[0].canDecide,false);
 for(const raw of [null,{}, {...page(),items:undefined},{...page(),total:'0'},{...page(),page:2},{...page(),pageSize:20},{...page(),items:[{...row,reviewToken:'bad'}]}])await assert.rejects(listApprovals({},async()=>raw));
 const unknown=await listApprovals({},async()=>page([{...row,requestType:'FUTURE_APPROVAL_KIND',canDecide:false}]));assert.equal(unknown.items[0].type,'other');
});
test('decision commands require an observed token, request identity and a rejection reason',async()=>{
 for(const patch of [{expectedReviewToken:undefined},{expectedReviewToken:'A'.repeat(64)},{requestKey:undefined},{requestKey:' short '},{decision:'CANCELLED'},{comment:'x'.repeat(1001)},{unexpected:true}]){
  assert.equal(approvalDecisionSchema.safeParse({...command,...patch}).success,false);await assert.rejects(decideApproval(id,{...command,...patch},async()=>assert.fail('invalid decision dispatched')));
 }
 assert.equal(approvalDecisionSchema.safeParse({...command,decision:'REJECTED',comment:' '}).success,false);
 const result=await decideApproval(id,command,async(url,init)=>{assert.equal(url,'/db/rpc/decide_approval_command');assert.deepEqual(JSON.parse(init.body),{p_id:id,p_review_token:reviewToken,p_decision:'APPROVED',p_comment:command.comment,p_request_key:command.requestKey});return {id,status:'approved',executionStatus:'FAILED',accepted:true};});
 assert.equal(result.accepted,true);assert.equal(result.executionStatus,'FAILED');
 for(const raw of [{id,status:'approved',executionStatus:'SUCCEEDED',accepted:false},{id,status:'rejected',executionStatus:'SUCCEEDED',accepted:true},{id:actor,status:'approved',executionStatus:'SUCCEEDED',accepted:true},{}])await assert.rejects(decideApproval(id,command,async()=>raw));
});
test('deadline changes and server permissions gate review without changing retained history',()=>{
 const now=Date.parse(stamp);assert.equal(approvalIsActionable(row,now),true);
 for(const patch of [{canDecide:false},{status:'approved'},{status:'cancelled'},{status:'expired'},{expiresAt:stamp},{expiresAt:'invalid'}])assert.equal(approvalIsActionable({...row,...patch},now),false);
 assert.equal(approvalDisplayStatus({...row,expiresAt:stamp},now),'expired');assert.equal(approvalDisplayStatus({...row,status:'approved',expiresAt:stamp},now),'approved');
 for(const result of [{id,status:'approved',executionStatus:'FAILED',accepted:true},{id,status:'rejected',executionStatus:'SUCCEEDED',accepted:true}])assert.equal(approvalDecisionResultSchema.safeParse(result).success,true);
});
test('approval copy distinguishes recorded decisions, execution failures and display recovery in both languages',()=>{
 assert.deepEqual(Object.keys(approvalReviewZh).sort(),Object.keys(approvalReviewEn).sort());
 assert.match(approvalReviewEn['approvalReview.executionFailed'],/decision was recorded/);assert.match(approvalReviewEn['approvalReview.refreshOnly'],/without submitting another/);assert.match(approvalReviewEn['approvalReview.summaryHelp'],/Pending excludes expired/);
 for(const type of approvalTypes.filter(type=>type.startsWith('revenue')||type==='other'))assert.ok(approvalReviewEn['approval.type.'+type]);
});
test('approval reads preserve RLS and custody lock order while receipts omit raw business content',async()=>{
 const sql=await readFile(new URL('../db/migrations/202610250141_approval_review_recovery.sql',import.meta.url),'utf8');
 const read=sql.slice(sql.indexOf('create function public.query_approval_workspace'),sql.indexOf('create function public.approval_pending_count'));
 assert.match(read,/security invoker/);assert.doesNotMatch(read,/'requestPayload'|'executionError'/);
 const write=sql.slice(sql.indexOf('create function public.decide_approval_command'));
 assert.ok(write.indexOf('public.cash_require')<write.indexOf('for update'));
 assert.ok(write.indexOf('public.approval_actor_can_decide')<write.indexOf("return receipt.result->'item'"));
 assert.match(sql,/extract\(epoch from p_request.updated_at\)/);
 assert.doesNotMatch(sql,/alter table public.approval_requests|disable trigger/i);
});

test('approval HTTP boundaries use real role/MFA/origin validation and the guarded command',async context=>{
 const output=path.resolve('work/approval-contract/routes.cjs');await mkdir(path.dirname(output),{recursive:true});
 const stubs={auth:`export const getCurrentUser=async()=>globalThis.__approvalTest.user;`,
  'db/gateway':`export class DatabaseRequestError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}};export const databaseJson=async(url,init)=>globalThis.__approvalTest.query(url,init);export const databaseRequest=databaseJson;`,
  observability:`export const emitObservabilityEvent=async()=>{};export const requestOutcome=()=> 'success';export const routeTemplate=value=>value;`};
 await build({stdin:{contents:`export {GET as list} from './app/api/approvals/route';export {POST as decide} from './app/api/approvals/[id]/decision/route';export {DatabaseRequestError} from './lib/db/gateway';`,resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'approval-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(key=>args.path===key||args.path.endsWith('/'+key));return key?{path:key,namespace:'approval-stub'}:undefined;});builder.onLoad({filter:/.*/,namespace:'approval-stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 const runtime=createRequire(import.meta.url)(output),previous=process.env.APP_URL;process.env.APP_URL='http://localhost:3200';
 const h=globalThis.__approvalTest={user:{id:actor,role:'ADMIN',aal:'aal2'},calls:[],query:async(url,init)=>{h.calls.push({url,body:JSON.parse(init.body)});return url.endsWith('query_approval_workspace')?page():{id,status:'approved',executionStatus:'FAILED',accepted:true};}};
 context.after(async()=>{delete globalThis.__approvalTest;if(previous===undefined)delete process.env.APP_URL;else process.env.APP_URL=previous;await rm(output,{force:true});});
 const request=(body=command,origin='http://localhost:3200')=>new Request(`http://localhost:3200/api/approvals/${id}/decision`,{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(body)});
 const args={params:Promise.resolve({id})};
 await context.test('recorded execution failure is a successful decision result',async()=>{
  const response=await runtime.decide(request(),args);assert.equal(response.status,200);assert.equal((await response.json()).item.executionStatus,'FAILED');assert.equal(h.calls.at(-1).url,'/db/rpc/decide_approval_command');
 });
 await context.test('missing snapshot, rejection reason, CSRF and origin are rejected before dispatch',async()=>{
  const before=h.calls.length;
  for(const body of [{decision:'APPROVED'},{...command,decision:'REJECTED',comment:''},{...command,unexpected:true}])assert.equal((await runtime.decide(request(body),args)).status,400);
  assert.equal((await runtime.decide(request(command,'https://untrusted.example.test'),args)).status,403);
  const csrf=request();csrf.headers.set('cookie','crm_session=fictional-session');assert.equal((await runtime.decide(csrf,args)).status,403);assert.equal(h.calls.length,before);
 });
 await context.test('current role and MFA remain mandatory',async()=>{
  const before=h.calls.length;h.user.role='SALES_SPECIALIST';assert.equal((await runtime.decide(request(),args)).status,403);h.user.role='ADMIN';h.user.aal='aal1';assert.equal((await runtime.decide(request(),args)).status,403);h.user.aal='aal2';assert.equal(h.calls.length,before);
 });
 await context.test('shareable scopes and all statuses are validated by the read endpoint',async()=>{
  const response=await runtime.list(new Request('http://localhost:3200/api/approvals?scope=mine&status=all&execution=FAILED&type=revenuePolicyVersion'));
  assert.equal(response.status,200);assert.equal(h.calls.at(-1).body.p_scope,'mine');assert.equal(h.calls.at(-1).body.p_type,'REVENUE_POLICY_VERSION');
  for(const query of ['page=0','pageSize=100','scope=workspace','status=lost','type=constructor','unknown=1'])assert.equal((await runtime.list(new Request('http://localhost:3200/api/approvals?'+query))).status,400);
 });
 await context.test('conflict and specialized denial codes never publish raw diagnostics',async()=>{
  for(const [code,status] of [['APPROVAL_SNAPSHOT_CONFLICT',409],['APPROVAL_REQUEST_CONFLICT',409],['APPROVAL_DOMAIN_REVIEW_REQUIRED',409],['APPROVAL_ACCESS_DENIED',403],['CASH_INDEPENDENT_REFUND_REVIEW',403],['REVENUE_AUTHORITY_REQUIRED',403]]){
   h.query=async()=>{throw new runtime.DatabaseRequestError(500,code,'Fictional internal diagnostic');};const response=await runtime.decide(request(),args);assert.equal(response.status,status);const body=await response.json();assert.equal(body.code,code);assert.ok(!JSON.stringify(body).includes('Fictional internal diagnostic'));
  }
 });
});
