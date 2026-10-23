import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';
import {calendarActionSchema,appointmentCreateSchema} from '../lib/calendar-actions.ts';
import {calendarAgenda,upsertCalendarEvent,calendarRelationTypes,reminderKeys} from '../lib/calendar-workspace.ts';
import {mutateAppointment} from '../lib/calendar-repository.ts';
import {createReceiptAttempt} from '../lib/receipt-attempt.ts';
import {listGeneratedJobs} from '../lib/generated-jobs-repository.ts';
import {canDownloadExport,effectiveExportStatus,exportStatusValid} from '../lib/export-job-state.ts';
import {calendarRecoveryEn,calendarRecoveryZh} from '../lib/i18n/locales/calendar-recovery.ts';

const id='00000000-0000-4000-8000-000000000001',receipt={expectedVersion:1,requestKey:'fictional-calendar-request'};
test('appointment actions require explicit current version and receipt identity',()=>{
 for(const action of ['COMPLETE','CANCEL'])assert.equal(calendarActionSchema.safeParse({action,...receipt}).success,true);
 for(const input of [{action:'COMPLETE'},{action:'CANCEL',...receipt,expectedVersion:0},{action:'UPDATE',...receipt,date:'2026-02-30',time:'10:00'},{action:'UPDATE',...receipt,date:'2026-10-23',time:'25:00'},{action:'COMPLETE',...receipt,requestKey:''}])assert.equal(calendarActionSchema.safeParse(input).success,false);
});
test('appointment creation uses supported relation pairs, stable minutes and explicit attendee consent',()=>{
 const input={title:'Fictional meeting',locale:'en',date:'2026-10-23',time:'10:00',type:'meeting',channel:'Teams',related:'',relatedType:null,relatedId:null,reminder:1440,attendees:[],requestKey:receipt.requestKey};
 assert.equal(appointmentCreateSchema.safeParse(input).success,true);
 assert.equal(appointmentCreateSchema.safeParse({...input,relatedType:'CONTACT',relatedId:id}).success,true);
 for(const patch of [{relatedType:'STUDENT',relatedId:id},{relatedType:'CONTACT'},{reminder:'1 day'},{attendees:[{email:'attendee@example.test',consentConfirmed:false}]}])assert.equal(appointmentCreateSchema.safeParse({...input,...patch}).success,false);
 assert.deepEqual(calendarRelationTypes,['ORGANIZATION','CONTACT']);assert.equal(reminderKeys[1440],'calendar.reminder.day');
});
test('exact request recovery retains original bytes across edited content and locale switches',()=>{
 let keys=0;const attempt=createReceiptAttempt(()=>`fictional-${++keys}`),first=attempt.prepare({title:'Original',reminder:1440,locale:'en'});
 assert.equal(attempt.prepare({title:'Edited',reminder:30,locale:'zh-CN'}),first);assert.equal(keys,1);
 attempt.clear();assert.notEqual(attempt.prepare({title:'Edited'}),first);assert.equal(keys,2);
});
test('calendar agenda exposes full selected-day history, deterministic ties and id-based reconciliation',()=>{
 const events=[{id:'b',date:'2026-10-22',time:'09:00'},{id:'a',date:'2026-10-22',time:'09:00'},{id:'c',date:'2026-10-24',time:'09:00'}];
 assert.deepEqual(calendarAgenda(events,'day','2026-10-23','2026-10-22').map(item=>item.id),['a','b']);
 assert.deepEqual(calendarAgenda(events,'upcoming','2026-10-23','2026-10-22').map(item=>item.id),['c']);
 const changed=upsertCalendarEvent(events,{...events[0],time:'11:00'});assert.equal(changed.length,3);assert.equal(changed.filter(item=>item.id==='b').length,1);assert.equal(events[0].time,'09:00');
});
test('calendar adapter carries action/version/key and converts reporting timezone before atomic RPC',async()=>{
 for(const action of ['COMPLETE','CANCEL','UPDATE']){
  let request;await mutateAppointment(id,calendarActionSchema.parse({action,...receipt,date:'2026-10-23',time:'10:00'}),'Asia/Taipei',async(url,init)=>{request={url,body:JSON.parse(init.body)};return {event_version:2};});
  assert.equal(request.url,'/db/rpc/mutate_calendar_appointment');assert.equal(request.body.expected_event_version,1);assert.equal(request.body.p_request_key,receipt.requestKey);assert.equal(request.body.action,action);
  assert.equal(request.body.starts,action==='UPDATE'?'2026-10-23T02:00:00.000Z':null);assert.equal(request.body.ends,action==='UPDATE'?'2026-10-23T03:00:00.000Z':null);
 }
});
test('download eligibility rejects deadline, missing/invalid expiry and non-ready status',()=>{
 const now=Date.parse('2026-10-23T02:00Z');
 for(const expiresAt of [null,'invalid','2026-10-23T02:00Z','2026-10-22T02:00Z'])assert.equal(canDownloadExport({status:'READY',expiresAt},now),false);
 assert.equal(canDownloadExport({status:'READY',expiresAt:'2026-10-24T02:00Z'},now),true);
 assert.equal(canDownloadExport({status:'QUEUED',expiresAt:'2026-10-24T02:00Z'},now),false);
 assert.equal(effectiveExportStatus({status:'READY',expiresAt:'2026-10-23T02:00Z'},now),'EXPIRED');
 assert.equal(exportStatusValid('unknown'),false);assert.equal(exportStatusValid('constructor'),false);assert.equal(exportStatusValid('READY'),true);
});
test('export queries align available/expired filters before paging and use stable ordering',async()=>{
 const now=Date.parse('2026-10-23T02:00Z');
 for(const status of ['all','READY','EXPIRED','FAILED']){
  let params,range;
  const result=await listGeneratedJobs({status,page:2,pageSize:10},async(url,init)=>{params=new URL(url,'https://example.test').searchParams;range=init.headers.Range;return new Response(JSON.stringify([{id,job_type:'CRM_EXPORT',parameters:{format:'XLSX'},status:'READY',created_at:'2026-10-22T00:00Z',expires_at:'2026-10-23T01:00Z',error_message:null}]),{headers:{'content-range':'10-10/11'}});},now);
  assert.equal(params.get('order'),'created_at.desc,id.desc');assert.equal(range,'10-19');assert.equal(result.items[0].status,'EXPIRED');assert.equal(result.total,11);
  if(status==='READY'){assert.equal(params.get('status'),'eq.READY');assert.equal(params.get('expires_at'),'gt.2026-10-23T02:00:00.000Z');}
  if(status==='EXPIRED'){assert.equal(params.get('status'),'in.(READY,EXPIRED)');assert.equal(params.get('or'),'(status.eq.EXPIRED,expires_at.lte.2026-10-23T02:00:00.000Z)');}
 }
});
test('export route preserves pagination and status validation errors for the API wrapper',async context=>{
 const output=path.resolve('work/v339/export-route.cjs');await mkdir(path.dirname(output),{recursive:true});context.after(()=>rm(output,{force:true}));
 const stubs={api:`export class ApiError extends Error{constructor(code,status){super(code);this.code=code;this.status=status;}}export const apiRoute=handler=>handler;export const requireApiUser=async()=>({});export const parsePagination=params=>{if(params.get('page')==='invalid')throw new ApiError('INVALID_PAGINATION',400);return {page:1,pageSize:10};};`,repo:`export const listGeneratedJobs=async()=>({items:[],total:0});`};
 await build({entryPoints:['app/api/exports/route.ts'],outfile:output,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent',plugins:[{name:'boundaries',setup(builder){builder.onResolve({filter:/^@\/lib\/(api|generated-jobs-repository)$/},args=>({path:args.path.endsWith('/api')?'api':'repo',namespace:'stub'}));builder.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 const runtime=createRequire(import.meta.url)(output);
 for(const [query,code] of [['page=invalid','INVALID_PAGINATION'],['status=unknown','INVALID_EXPORT_STATUS']])await assert.rejects(runtime.GET(new Request(`https://example.test/api/exports?${query}`)),error=>error.status===400&&error.code===code);
 assert.equal((await runtime.GET(new Request('https://example.test/api/exports?status=READY'))).status,200);
});
test('bilingual recovery messages remain matched',async()=>{
 assert.deepEqual(Object.keys(calendarRecoveryZh).sort(),Object.keys(calendarRecoveryEn).sort());
 const changed=await readFile(new URL('../db/migrations/202610230136_calendar_action_receipts.sql',import.meta.url),'utf8');assert.ok(changed.includes('mutate_calendar_appointment'));
});
