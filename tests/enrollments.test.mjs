import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {enrollmentDataSchema,enrollmentSaveSchema,attributionDataSchema,attributionSaveSchema,enrollmentTimestamp} from "../lib/enrollment-input.ts";
import {listEnrollments,getEnrollment,saveEnrollment,listEnrollmentStatusHistory,listEnrollmentAttributions,saveEnrollmentAttribution,lookupEnrollmentRelations} from "../lib/enrollment-repository.ts";
import {enrollmentPrivacyRecords} from "../scripts/lib/enrollment-privacy-export.mjs";
import {enEnrollments,zhEnrollments} from "../lib/i18n/locales/enrollments.ts";
import {ApiClientError} from "../lib/api-client.ts";
import {presentApiError} from "../lib/api-error-presenter.ts";
const data={student_id:randomUUID(),cohort_id:randomUUID(),household_id:null,opportunity_id:null,status:"INTERESTED",owner_id:randomUUID(),sales_owner_id:null,enrolled_at:null,completed_at:null,withdrawn_at:null,withdrawal_reason:""};
const source={enrollment_id:randomUUID(),attribution_type:"PRIMARY",source_organization_id:randomUUID(),source_contact_id:null,source_event_id:null,source_campaign_id:null,source_referral_id:null,note:"School referral"};
test("enrollment create/update use existing IDs and a strict revision/request contract",()=>{
  assert.deepEqual(enrollmentDataSchema.parse(data),data);
  assert.equal(enrollmentSaveSchema.parse({id:randomUUID(),expectedRevision:null,requestKey:randomUUID(),data}).statusReason,"");
  for(const patch of [{status:"OFFERED"},{owner_id:null},{student_id:"name"},{cohort_id:"GAPP"},{capacity:30}])assert.equal(enrollmentDataSchema.safeParse({...data,...patch}).success,false);
  for(const expectedRevision of [0,-1,1.5])assert.equal(enrollmentSaveSchema.safeParse({id:randomUUID(),expectedRevision,requestKey:randomUUID(),data}).success,false);
});
test("lifecycle requirements and timestamp comparisons respect UTC offsets",()=>{
  for(const patch of [{status:"ACTIVE"},{status:"COMPLETED",enrolled_at:"2027-09-01T00:00:00Z"},{status:"WITHDRAWN",withdrawn_at:"2027-09-01T00:00:00Z"},
    {enrolled_at:"2027-09-01T09:00:00+08:00",completed_at:"2027-09-01T00:30:00Z"},
    {enrolled_at:"2027-09-01T00:00:00Z",withdrawn_at:"2027-08-01T00:00:00Z"}])assert.equal(enrollmentDataSchema.safeParse({...data,...patch}).success,false);
  assert.ok(enrollmentDataSchema.safeParse({...data,status:"COMPLETED",enrolled_at:"2027-09-01T09:00:00+08:00",completed_at:"2027-09-01T02:00:00Z"}).success);
  assert.ok(enrollmentDataSchema.safeParse({...data,status:"WITHDRAWN",withdrawn_at:"2027-09-01T00:00:00Z",withdrawal_reason:"Changed plans"}).success);
  assert.ok(enrollmentDataSchema.safeParse({...data,status:"CANCELLED"}).success);
});
test("attribution requires at least one real source and allows combined contexts",()=>{
  assert.ok(attributionSaveSchema.safeParse({id:randomUUID(),requestKey:randomUUID(),data:source}).success);
  assert.ok(attributionDataSchema.safeParse({...source,source_contact_id:randomUUID(),source_event_id:randomUUID()}).success);
  assert.ok(attributionDataSchema.safeParse({...source,attribution_type:"ASSIST"}).success);
  assert.equal(attributionDataSchema.safeParse({...source,source_organization_id:null}).success,false);
  assert.equal(attributionDataSchema.safeParse({...source,attribution_type:"FIRST"}).success,false);
  assert.equal(attributionDataSchema.safeParse({...source,note:"x".repeat(1001)}).success,false);
});
test("unchanged visible lifecycle dates preserve precise original timestamps",()=>{
  const original="2027-09-01T00:00:12.123456+00:00",local=()=>"2027-09-01T08:00";
  assert.equal(enrollmentTimestamp("2027-09-01T08:00",original,local,()=>{throw Error("must preserve");}),original);
  assert.equal(enrollmentTimestamp("",original,local,()=>"changed"),null);
  assert.equal(enrollmentTimestamp("2027-09-02T08:00",original,local,()=>"changed"),"changed");
});
test("repository uses scoped pagination, filters, immutable identities and stable receipt keys",async()=>{
  const calls=[],row={...data,id:randomUUID(),revision:2};
  const adapter={json:async(url,init)=>{calls.push({url,init});return url.includes("/rpc/")?row:[row];},request:async(url,init)=>{calls.push({url,init});return new Response(JSON.stringify([row]),{headers:{"content-range":"20-39/42"}});}};
  const result=await listEnrollments({page:2,pageSize:20,query:"Zhang",studentId:data.student_id,cohortId:data.cohort_id,status:"INTERESTED",ownerId:data.owner_id},adapter);
  assert.equal(result.total,42);assert.equal(calls[0].init.headers.Range,"20-39");
  const params=new URL(calls[0].url,"http://localhost").searchParams;
  assert.equal(params.get("student_id"),`eq.${data.student_id}`);assert.equal(params.get("cohort_id"),`eq.${data.cohort_id}`);assert.equal(params.get("status"),"eq.INTERESTED");assert.match(params.get("or"),/student_name_zh/);
  assert.equal((await getEnrollment(row.id,adapter)).id,row.id);
  const input={id:row.id,expectedRevision:1,requestKey:randomUUID(),statusReason:"Started",data};
  await saveEnrollment(input,adapter);const payload=JSON.parse(calls.at(-1).init.body);
  assert.deepEqual(payload,{record_id:row.id,expected_revision:1,p_request_key:input.requestKey,status_reason:"Started",data});
  await listEnrollmentStatusHistory(row.id,2,adapter);assert.equal(new URL(calls.at(-1).url,"http://localhost").searchParams.get("offset"),"50");
  await listEnrollmentAttributions(row.id,1,adapter);assert.match(calls.at(-1).url,/enrollment_attribution_records/);
  await saveEnrollmentAttribution({id:row.id,requestKey:input.requestKey,data:source},adapter);assert.equal(JSON.parse(calls.at(-1).init.body).p_request_key,input.requestKey);
  const referrals=await lookupEnrollmentRelations("REFERRAL","School",{...adapter,json:async(url)=>{assert.match(url,/enrollment_referral_options/);assert.match(new URL(url,"http://localhost").searchParams.get("or"),/organization_name_en.ilike.\*School\*/);return[{id:row.id,referred_on:"2026-10-03",organization_name_zh:"学校",organization_name_en:"School",household_name_zh:"家庭",household_name_en:"Family"}];}});
  assert.equal(referrals[0].labelEn,"School → Family · 2026-10-03");assert.equal(referrals[0].labelZh,"学校 → 家庭 · 2026-10-03");
});
test("privacy export scopes all three business facts and excludes source-profile copies",async()=>{
  const ws=randomUUID(),student=randomUUID(),id=randomUUID(),calls=[];
  const request=async url=>{calls.push(url);return url.includes("/student_enrollments?")?[{id,workspace_id:ws,student_id:student}]:[{id:randomUUID(),workspace_id:ws,enrollment_id:id}];};
  const rows=await enrollmentPrivacyRecords(request,ws,[student]);
  assert.equal(rows.enrollments.length,1);assert.equal(rows.history.length,1);assert.equal(rows.attributions.length,1);
  assert.ok(calls.every(url=>url.includes(`workspace_id=eq.${ws}`)));
  assert.deepEqual(await enrollmentPrivacyRecords(()=>{throw Error("no query");},ws,[]),{enrollments:[],history:[],attributions:[]});
  await assert.rejects(enrollmentPrivacyRecords(async()=>[{id,workspace_id:randomUUID(),student_id:student}],ws,[student]),/scope mismatch/);
  await assert.rejects(enrollmentPrivacyRecords(request,"bad",[student]),/Invalid enrollment privacy scope/);
});
test("validation, permissions, conflict and retry messages are bilingual",()=>{
  assert.deepEqual(Object.keys(enEnrollments).sort(),Object.keys(zhEnrollments).sort());
  for(const [code,key] of [["ENROLLMENT_VERSION_CONFLICT","enrollments.versionConflict"],["ENROLLMENT_PRIMARY_CONFLICT","enrollments.primaryConflict"],["ENROLLMENT_SOURCE_FORBIDDEN","enrollments.sourceForbidden"],["ENROLLMENT_DUPLICATE","enrollments.duplicate"]])for(const messages of [enEnrollments,zhEnrollments]){
    const result=presentApiError(new ApiClientError(code,409,"enrollment-request"),key=>messages[key]??key,"enrollments.saveFailed");assert.ok(result.message.startsWith(messages[key]));assert.match(result.message,/enrollment-request/);
  }
});
