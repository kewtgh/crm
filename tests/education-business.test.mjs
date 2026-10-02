import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { en } from "../lib/i18n/locales/en.ts";
import { zhCN } from "../lib/i18n/locales/zh-CN.ts";
import { businessConfig,businessContextFilters,businessResourcesFor,businessSaveSchema,businessWarnings } from "../lib/education-business.ts";
import { listEducationBusiness,saveEducationBusiness } from "../lib/education-business-repository.ts";
import { enEducationBusiness,zhEducationBusiness } from "../lib/i18n/locales/education-business.ts";
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const validNeeds={id,services:["FOUNDATION","STUDY_TOUR"],target_regions:["UK"],budget_min:null,budget_max:null,budget_currency:"GBP",target_intake:null,decision_stage:"DISCOVERY",next_action:"确认入学目标"};
const input=(resource,data)=>({resource,id,expectedRevision:null,data});
test("family budget distinguishes unknown and zero; malformed ranges, duplicate roles and extra keys are rejected",()=>{
  assert.equal(businessSaveSchema.parse(input("needs",validNeeds)).data.budget_min,null);
  assert.equal(businessSaveSchema.parse(input("needs",{...validNeeds,budget_min:0,budget_max:0})).data.budget_max,0);
  for(const change of [{budget_min:200,budget_max:100},{budget_min:-1},{budget_min:0.555},{budget_currency:"JPY"},{services:["FOUNDATION","FOUNDATION"]},{annual_income:50000},{id:other},{budget_min:"100"}])assert.equal(businessSaveSchema.safeParse(input("needs",{...validNeeds,...change})).success,false);
  assert.equal(businessSaveSchema.parse(input("needs",{...validNeeds,next_action:"  next  "})).data.next_action,"next");
});
test("pathways enforce actual language score scales and deadline ordering without requiring guessed scores",()=>{
  const data={student_id:id,program_type:"BRIDGE",target_organization_id:null,target_region:"",target_major:"",intake_date:"2027-09-01",application_deadline:"2027-06-01",language_test:"NONE",language_score:null,stage:"EXPLORING",next_action:""};
  assert.equal(businessSaveSchema.safeParse(input("pathways",data)).success,true);
  for(const change of [{language_score:6},{language_test:"IELTS",language_score:10},{language_test:"TOEFL",language_score:121},{language_test:"DUOLINGO",language_score:161},{application_deadline:"2027-10-01"},{intake_date:"2027-02-30"},{program_type:"STUDY_TOUR"}])assert.equal(businessSaveSchema.safeParse(input("pathways",{...data,...change})).success,false);
  assert.equal(businessSaveSchema.safeParse(input("pathways",{...data,language_test:"IELTS",language_score:6.5})).success,true);
});
test("outreach distinguishes planned and actual counts and rejects reversed dates/self-partnership",()=>{
  const event={name:"School seminar",organization_id:id,partner_organization_id:null,kind:"SEMINAR",starts_on:"2026-10-02",ends_on:"2026-10-02",location:"",capacity:null,attendee_count:null,status:"DRAFT",next_action:""};
  assert.equal(businessSaveSchema.safeParse(input("events",event)).success,true);
  for(const change of [{ends_on:"2026-10-01"},{capacity:1,attendee_count:2},{capacity:2.5},{partner_organization_id:id}])assert.equal(businessSaveSchema.safeParse(input("events",{...event,...change})).success,false);
});
test("context filters never widen unsupported customer combinations",()=>{
  assert.deepEqual(businessResourcesFor({type:"STUDENT",id}),["pathways"]);
  assert.deepEqual(businessResourcesFor({type:"HOUSEHOLD",id}),["needs","referrals"]);
  assert.equal(businessContextFilters("events",{type:"ORGANIZATION",id}).or,`(organization_id.eq.${id},partner_organization_id.eq.${id})`);
  assert.throws(()=>businessContextFilters("pathways",{type:"HOUSEHOLD",id}),/BUSINESS_CONTEXT_INVALID/);
});
test("advice uses specific missing facts and dates, not family income or relationship familiarity",()=>{
  assert.ok(businessWarnings("needs",validNeeds,"2026-10-02").includes("budgetMissing"));
  assert.ok(!businessWarnings("needs",{...validNeeds,budget_min:0},"2026-10-02").includes("budgetMissing"));
  const row={stage:"PREPARING",application_deadline:"2026-10-01",intake_date:"2027-09-01",target_region:"UK",next_action:"Follow up"};
  assert.deepEqual(businessWarnings("pathways",row,"2026-10-02"),["deadlinePassed"]);
  assert.deepEqual(businessWarnings("pathways",{...row,stage:"ENROLLED"},"2026-10-02"),[]);
  assert.deepEqual(businessWarnings("events",{status:"COMPLETED",ends_on:"2026-10-01"},"2026-10-02"),[]);
});
test("paged repository minimizes fields, resolves related labels and retains per-record permissions",async()=>{
  const paths=[];
  const adapter={request:async(path,init)=>{paths.push(path);assert.equal(init.headers.Range,"20-39");const params=new URL(path,"http://local").searchParams;assert.equal(params.get("household_id"),`eq.${id}`);assert.ok(!params.get("select").includes("workspace_id"));return Response.json([{id:other,revision:1,source_organization_id:id,household_id:id,event_id:null,introduced_by_contact_id:null}],{headers:{"content-range":"20-20/21"}});},json:async(path,init)=>{
    paths.push(path);if(path.includes("permissions")){assert.deepEqual(JSON.parse(init.body).record_ids,[other]);return[{id:other,can_edit:false}];}
    if(path.includes("today"))return"2026-10-02";
    return[{id,name_zh:"客户",name_en:"Customer"}];
  }};
  const page=await listEducationBusiness("referrals",{page:2,pageSize:20,context:{type:"HOUSEHOLD",id}},adapter);
  assert.equal(page.total,21);assert.equal(page.labels[`ORGANIZATION:${id}`],"客户 / Customer");assert.deepEqual(page.editableIds,[]);assert.equal(page.today,"2026-10-02");assert.ok(paths.every(path=>!path.includes("select=*")));
  const requests=[];await saveEducationBusiness(input("needs",validNeeds),{json:async(path,init)=>{requests.push(JSON.parse(init.body));return{};}});
  assert.equal(requests[0].expected_revision,null);assert.equal(requests[0].record_id,id);
});
test("all business fields, options and warnings have Chinese and English copy",()=>{
  for(const config of Object.values(businessConfig))for(const field of config.fields){assert.ok(enEducationBusiness[`business.field.${field.key}`]);assert.ok(zhEducationBusiness[`business.field.${field.key}`]);for(const option of field.options??[])if(option){assert.ok(enEducationBusiness[`business.option.${option}`],option);assert.ok(zhEducationBusiness[`business.option.${option}`],option);}}
  assert.deepEqual(Object.keys(enEducationBusiness).sort(),Object.keys(zhEducationBusiness).sort());
});
test("workspace labels resolve in both application locales, including refresh and retry",async()=>{
  const source=await readFile(new URL("../components/education-business-workspace.tsx",import.meta.url),"utf8");
  const keys=[...source.matchAll(/\bt\("([a-zA-Z][a-zA-Z0-9.]+)"/g)].map(match=>match[1]);
  for(const key of keys){assert.ok(en[key],`English: ${key}`);assert.ok(zhCN[key],`Chinese: ${key}`);}
});
