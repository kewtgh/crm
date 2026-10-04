import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {applicationDataSchema,applicationSaveSchema,applicationFiltersSchema} from "../lib/application-input.ts";
import {listApplications,getApplication,saveApplication,listApplicationStatusHistory,listApplicationTasks,saveApplicationTask} from "../lib/application-repository.ts";
import {businessSaveSchema} from "../lib/education-business.ts";
import {applicationPrivacyRecords} from "../scripts/lib/application-privacy-export.mjs";
import {enApplications,zhApplications} from "../lib/i18n/locales/applications.ts";
import {presentApiError} from "../lib/api-error-presenter.ts";
import {ApiClientError} from "../lib/api-client.ts";
const data={enrollment_id:randomUUID(),target_organization_id:null,external_application_id:null,deadline_on:null,status:"DRAFT",decision:null,submitted_at:null,decision_at:null,withdrawn_at:null,owner_id:null};
test("application identity is enrollment-only, lifecycle and decision are separate",()=>{
 assert.deepEqual(applicationDataSchema.parse(data),data);
 for(const patch of [{student_id:randomUUID()},{product_id:randomUUID()},{cohort_id:randomUUID()},{enrollment_id:"Student name"},{status:"ADMITTED"},{decision:"PAID"}])assert.equal(applicationDataSchema.safeParse({...data,...patch}).success,false);
 assert.equal(applicationSaveSchema.parse({id:randomUUID(),expectedRevision:null,requestKey:randomUUID(),data}).statusReason,"");
 for(const expectedRevision of [0,-1,1.1,2147483648])assert.equal(applicationSaveSchema.safeParse({id:randomUUID(),expectedRevision,requestKey:randomUUID(),data}).success,false);
});
test("lifecycle dates require real submission/decision/withdrawal facts and compare offsets",()=>{
 for(const patch of [{status:"SUBMITTED"},{status:"UNDER_REVIEW"},{status:"DECIDED",submitted_at:"2027-01-01T00:00:00Z"},{decision:"ADMITTED"},{status:"WITHDRAWN"},{submitted_at:"2027-01-01T09:00:00+08:00",decision_at:"2027-01-01T00:30:00Z"}])assert.equal(applicationDataSchema.safeParse({...data,...patch}).success,false);
 assert.equal(applicationDataSchema.safeParse({...data,status:"DECIDED",decision:"WAITLISTED",submitted_at:"2027-01-01T09:00:00+08:00",decision_at:"2027-01-01T02:00:00Z"}).success,true);
 assert.equal(applicationDataSchema.safeParse({...data,status:"WITHDRAWN",withdrawn_at:"2027-01-01T00:00:00Z"}).success,true);
 assert.equal(applicationDataSchema.safeParse({...data,deadline_on:"2020-01-01"}).success,true);
});
test("application filters and pagination retain deterministic identity and currency-independent scope",async()=>{
 const calls=[],enrollmentId=randomUUID(),studentId=randomUUID(),cohortId=randomUUID(),productId=randomUUID(),ownerId=randomUUID(),targetOrganizationId=randomUUID();
 const adapter={json:async()=>[],request:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify([]),{headers:{"content-range":"20-39/44"}});}};
 const page=await listApplications(applicationFiltersSchema.parse({page:2,enrollmentId,studentId,cohortId,productId,ownerId,targetOrganizationId,status:"DECIDED",decision:"ADMITTED",query:"A*(B)_",deadlineFrom:"2027-01-01",deadlineTo:"2027-03-01"}),adapter);
 const url=new URL(calls[0].url,"http://localhost");assert.equal(url.searchParams.get("enrollment_id"),`eq.${enrollmentId}`);assert.equal(url.searchParams.get("student_id"),`eq.${studentId}`);assert.equal(url.searchParams.get("cohort_id"),`eq.${cohortId}`);assert.equal(url.searchParams.get("product_id"),`eq.${productId}`);assert.equal(url.searchParams.get("owner_id"),`eq.${ownerId}`);assert.equal(url.searchParams.get("target_organization_id"),`eq.${targetOrganizationId}`);assert.equal(url.searchParams.get("decision"),"eq.ADMITTED");assert.equal(url.searchParams.get("and"),"(deadline_on.gte.2027-01-01,deadline_on.lte.2027-03-01)");assert.equal(calls[0].init.headers.Range,"20-39");assert.equal(page.total,44);
 assert.equal(applicationFiltersSchema.safeParse({deadlineFrom:"2027-02-01",deadlineTo:"2027-01-01"}).success,false);
 assert.equal(applicationFiltersSchema.safeParse({pageSize:51}).success,false);
});
test("save and retry use identical immutable identity, revision and receipt keys",async()=>{
 const calls=[],adapter={json:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return{id:"id",revision:2};},request:async()=>new Response("[]")},input=applicationSaveSchema.parse({id:randomUUID(),expectedRevision:1,requestKey:randomUUID(),statusReason:"Preparing",data});
 await saveApplication(input,adapter);await saveApplication(input,adapter);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].body.p_request_key,input.requestKey);assert.equal(calls[0].body.expected_revision,1);assert.equal(calls[0].body.data.enrollment_id,data.enrollment_id);
});
test("application history and tasks are bounded to the application, tasks reuse existing mutation",async()=>{
 const calls=[],adapter={json:async(url,init)=>{calls.push({url,init});return[];},request:async()=>new Response("[]")},id=randomUUID();
 assert.equal(await getApplication(id,adapter),null);await listApplicationStatusHistory(id,2,adapter);await listApplicationTasks(id,3,adapter);
 assert.equal(new URL(calls[1].url,"http://localhost").searchParams.get("offset"),"50");assert.equal(new URL(calls[2].url,"http://localhost").searchParams.get("application_id"),`eq.${id}`);
 await saveApplicationTask({id:randomUUID(),expectedRevision:null,data:{student_id:randomUUID(),application_id:id,title:"Prepare",due_on:null,status:"TODO",next_action:""}},adapter);assert.equal(calls[3].url,"/db/rpc/save_education_business");assert.equal(JSON.parse(calls[3].init.body).data.application_id,id);
});
test("legacy task omission preserves context; explicit null permits generic tasks",()=>{
 const input={resource:"applications",id:randomUUID(),expectedRevision:null,data:{student_id:randomUUID(),title:"Legacy task",due_on:null,status:"TODO",next_action:""}};
 const old=businessSaveSchema.parse(input);assert.ok(!Object.hasOwn(old.data,"application_id"));assert.equal(businessSaveSchema.parse({...input,data:{...input.data,application_id:null}}).data.application_id,null);assert.equal(businessSaveSchema.parse({...input,data:{...input.data,application_id:randomUUID()}}).data.application_id.length,36);
});
test("privacy export follows workspace/enrollment/application IDs without duplicating tasks",async()=>{
 const workspace=randomUUID(),enrollment=randomUUID(),id=randomUUID(),calls=[];
 const result=await applicationPrivacyRecords(async url=>{calls.push(url);return url.includes("status_history")?[{workspace_id:workspace,application_id:id}]:[{workspace_id:workspace,id,enrollment_id:enrollment}];},workspace,[enrollment]);assert.equal(result.applications.length,1);assert.equal(result.history.length,1);assert.equal(calls.length,2);assert.ok(calls.every(url=>url.includes(`workspace_id=eq.${workspace}`)));assert.ok(calls.every(url=>!url.includes("tasks")));
 await assert.rejects(applicationPrivacyRecords(async()=>[{workspace_id:randomUUID(),id,enrollment_id:enrollment}],workspace,[enrollment]),/scope mismatch/);
 await assert.rejects(applicationPrivacyRecords(async()=>[{workspace_id:workspace,id,enrollment_id:randomUUID()}],workspace,[enrollment]),/scope mismatch/);
 assert.deepEqual(await applicationPrivacyRecords(()=>{throw new Error("must not read");},workspace,[]),{applications:[],history:[]});
});
test("every application label and actionable mutation error is bilingual",()=>{
 assert.deepEqual(Object.keys(enApplications).sort(),Object.keys(zhApplications).sort());for(const messages of [enApplications,zhApplications])for(const text of Object.values(messages))assert.ok(text.trim());
 const translator=key=>zhApplications[key]??key;
 assert.equal(presentApiError(new ApiClientError("APPLICATION_VERSION_CONFLICT",409),translator,"applications.saveFailed").message,zhApplications["applications.versionConflict"]);
});
