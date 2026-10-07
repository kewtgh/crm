import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { followUpProgress } from "../lib/customer-operations.ts";
import { CUSTOMER_EMAIL_TEMPLATES,renderCustomerEmail } from "../lib/customer-email-templates.ts";
import { customEmailSchema,savedEmailSchema,archiveEmailSchema } from "../lib/customer-email-input.ts";
import { buildImportTemplate,importExamples,importFieldFormat } from "../lib/import-template.ts";
import { importFieldsByResource } from "../lib/import-fields.ts";
import { parseCsvDocument } from "../lib/csv.ts";
import { compressAvatar,AVATAR_MAX_BYTES } from "../lib/avatar-image.ts";
import sharp from "sharp";
import { queueCustomerEmail,previewCustomerEmail } from "../lib/customer-email-repository.ts";
import { loadCustomerOperations } from "../lib/customer-operations-repository.ts";
import { followUpCompletionPath } from "../lib/customer-operations-view.ts";
import { customerEmailBatchPayload,freezeCustomerEmailBatch } from "../lib/customer-email-batch.ts";
import { automationInputSchema } from "../lib/automation-input.ts";
import { PORTAL_INVITATION_PRESETS,portalTemplateContentSchema,renderPortalInvitation } from "../lib/portal-invitation-templates.ts";
const source=file=>readFile(new URL(`../${file}`,import.meta.url),"utf8");
test("goal completion uses repeated UTC bounds accepted by the local gateway",()=>{
  const params=new URL(followUpCompletionPath("CONTACT","id",{start_date:"2026-10-01",due_date:"2026-10-31"}),"http://local").searchParams;
  assert.equal(params.has("and"),false);
  assert.deepEqual(params.getAll("occurred_at"),["gte.2026-10-01T00:00:00Z","lt.2026-11-01T00:00:00.000Z"]);
  assert.match(params.get("kind"),/MEAL/);
});
test("real repository strips unrequested nested data, omits institution opportunities for contacts, and returns edit access",async()=>{
  const calls=[],plan={id:"plan",title:"目标",target_level:2,target_count:3,start_date:"2026-10-01",due_date:"2026-10-31",updated_at:"now",workspace_id:"private"};
  const adapter={json:async(path,init)=>{
    calls.push(path);if(path.includes("customer_subject_access"))return !JSON.parse(init.body).edit;
    if(path.includes("customer_follow_up_plans"))return [plan];
    if(path.includes("customer_contract_links"))return [{contracts:{id:"contract",contract_number:"C-1",product_id:"product",owner_id:"owner",private_audit:"secret"}}];
    if(path.includes("/contacts?"))return [{id:"contact",name_zh:"客户",name_en:null,organization_id:"org",owner_id:"owner",notes_markdown:"需求",passport_number:"secret",private_flags:"secret"}];
    if(path.includes("user_profiles"))return [{user_id:"owner",display_name_zh:"负责人",display_name_en:null,password_hash:"secret"}];
    if(path.includes("/products?"))return [{id:"product",name_zh:"服务",name_en:"Service",internal_cost:"secret"}];
    return [];
  },request:async path=>{
    calls.push(path);const params=new URL(path,"http://local").searchParams;assert.equal(params.has("and"),false);
    if(params.get("select")==="id"){assert.equal(params.getAll("occurred_at").length,2);return Response.json([],{headers:{"content-range":"0-0/123"}});}
    return Response.json([{id:"entry",kind:"CALL",summary:"沟通",next_step:"会议",occurred_at:"2026-10-02T00:00:00Z",workspace_id:"private",request_key:"private"}],{headers:{"content-range":"0-0/1"}});
  }};
  const result=await loadCustomerOperations("CONTACT","contact",{contracts:true,opportunities:true},adapter);
  assert.equal(result.completed,123);assert.equal(result.canManage,false);assert.equal(result.nameEn,"");assert.equal(result.ownerName,"负责人");assert.deepEqual(result.opportunities,[]);
  assert.ok(!calls.some(path=>path.includes("/opportunities?")));
  assert.equal(result.profile.passport_number,undefined);assert.equal(result.contracts[0].private_audit,undefined);assert.equal(result.products[0].internal_cost,undefined);assert.equal(result.plan.workspace_id,undefined);assert.equal(result.entries[0].request_key,undefined);
});
test("household archived parents and child contacts do not participate in relationship aggregation",async()=>{
  const adapter={json:async(path)=>{
    if(path.includes("customer_subject_access"))return true;
    if(path.includes("/households?"))return [{name_zh:"家庭",name_en:"Family"}];
    if(path.includes("household_members?"))return [{member_role:"PARENT",contacts:{id:"active",name_zh:"家长",communication_level:2,archived_at:null}},{member_role:"PARENT",contacts:{id:"archived",communication_level:4,archived_at:"2026-10-01"}}];
    if(path.includes("/students?"))return [{id:"child",contacts:{name_zh:"孩子",archived_at:null}},{id:"archived-child",contacts:{name_zh:"归档孩子",archived_at:"2026-10-01"}}];
    return [];
  },request:async()=>Response.json([],{headers:{"content-range":"0-0/0"}})};
  const result=await loadCustomerOperations("HOUSEHOLD","family",{contracts:false,opportunities:false},adapter);
  assert.equal(result.level,2);assert.deepEqual(result.contacts.map(row=>row.id),["active"]);assert.deepEqual(result.students.map(row=>row.id),["child"]);assert.equal(result.students[0].contacts,undefined);
});
test("bulk retry keeps the original preview language/hash/key even after locale changes",()=>{
  const preview={items:[],hash:"a".repeat(64),locale:"zh-CN"};
  const result=customerEmailBatchPayload("queue",["customer"],"FOLLOW_UP","en","stable-key",preview);
  assert.equal(result.locale,"zh-CN");assert.equal(result.requestKey,"stable-key");assert.equal(result.previewHash,preview.hash);
  assert.throws(()=>customerEmailBatchPayload("queue",[],"FOLLOW_UP","en","key",null),/EMAIL_PREVIEW_REQUIRED/);
});
test("automation accepts one action-title language, rejects blanks and invalid originals, and preserves run guards",()=>{
  const valid={operation:"create",nameZh:"测试规则",triggerKey:"MANUAL",actionType:"TASK",titleZh:"跟进客户",priority:"NORMAL",dueHours:24};
  const parsed=automationInputSchema.parse(valid);assert.equal(parsed.titleEn,"跟进客户");assert.equal(parsed.nameEn,"测试规则");
  for(const input of [{...valid,titleZh:""},{...valid,titleZh:"a"},{...valid,titleEn:42},{...valid,titleZh:"a".repeat(161)}])assert.equal(automationInputSchema.safeParse(input).success,false);
  assert.equal(automationInputSchema.safeParse({operation:"run",triggerKey:"UNKNOWN",eventKey:"long-key"}).success,false);
});
test("follow-up insights count remaining contacts, exact UTC deadline and evidence-based achievement",()=>{
  const plan={target_count:3,target_level:3,start_date:"2026-10-01",due_date:"2026-10-31"};
  const progress=followUpProgress(plan,[],2,"2026-11-02",2);
  assert.equal(progress.remaining,1);assert.equal(progress.daysRemaining,-2);assert.equal(progress.achieved,false);
  assert.equal(followUpProgress(plan,[],3,"2026-11-02",4).achieved,true);
});
test("mutation interfaces lock in-flight drafts and explicitly confirm trigger-wide automation",async()=>{
  const panel=await source("components/customer-operations-panel.tsx");assert.match(panel,/hidden=\{activeTab!=="followUp"&&activeTab!=="activity"\}/);assert.match(panel,/disabled=\{pending\}/);assert.match(panel,/if\(busy.current\)return/);assert.match(panel,/audit.savedRefreshFailed/);assert.match(panel,/runContractSearch/);
  const email=await source("components/customer-email-panel.tsx");assert.match(email,/customerEmailBatchPayload/);assert.match(email,/if\(busy.current\)return;change\(true\);setIds\(\[\]\)/);
  const automation=await source("components/automation-workspace.tsx");assert.match(automation,/runRule&&<ConfirmDialog/);assert.match(automation,/audit.runEventConfirm/);assert.doesNotMatch(automation,/name="title(?:Zh|En)" required/);
});
test("customer opportunity deep links validate IDs, preserve RLS reads, and use the linked currency",async()=>{
  const page=await source("app/(crm)/opportunities/page.tsx");assert.match(page,/z.uuid\(\).safeParse\(params.focus\)/);assert.match(page,/listOpportunities\(\{id:focus/);assert.match(page,/focused\?\.items\[0\]\?\.currency/);assert.match(page,/requireCapability\("opportunities.view"\)/);
  const repo=await source("lib/sales-repository.ts");assert.match(repo,/params.set\("id",`eq.\$\{input.id\}`\)/);
  const editor=await source("components/crm-record-editor.tsx");assert.match(editor,/lumina:crm-record-saved/);
});
test("follow-up targets count date-bounded entries, exact totals beyond list limits and overdue levels",()=>{
  const plan={target_count:3,target_level:3,start_date:"2026-10-01",due_date:"2026-10-31"};
  const entries=["2026-09-30T23:59:00Z","2026-10-01T00:00:00Z","2026-10-31T23:59:00Z","2026-11-01T00:00:00Z"].map(occurred_at=>({kind:"CALL",occurred_at}));
  entries.push({kind:"NOTE",occurred_at:"2026-10-02T00:00:00Z"});
  assert.equal(followUpProgress(plan,entries,1,"2026-11-01").completed,2);
  assert.equal(followUpProgress(plan,entries,1,"2026-11-01").overdue,true);
  assert.equal(followUpProgress(plan,entries,3,"2026-11-01",100).overdue,false);
  assert.equal(followUpProgress(plan,entries,3,"2026-11-01",100).completed,100);
  assert.equal(followUpProgress(null,[],4,"2026-10-01").nextLevel,4);
});
test("all templates substitute actual customer/owner names without interpreting placeholders",()=>{
  for(const template of CUSTOMER_EMAIL_TEMPLATES)for(const locale of ["zh-CN","en"]){const result=renderCustomerEmail(template,locale,"客户{{name}}","负责{{owner}}");assert.ok(result.body.includes("客户{{name}}"));assert.ok(result.body.includes("负责{{owner}}"));assert.ok(result.subject.length>=2);assert.equal(result.purpose,template.startsWith("PROGRAM")?"MARKETING":"SERVICE");}
});
test("bulk email uses individual durable keys, bounded concurrency, suppression and partial error results",async()=>{
  const seen=new Map(),threads=[],deliveries=[];let active=0,max=0;
  const adapter={createThread:async input=>{threads.push(input);return{id:input.contactId};},queueMessage:async(id,body,key)=>{active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,2));active--;if(id==="denied")throw{code:"COMMUNICATION_CONSENT_REQUIRED"};seen.set(key,body);deliveries.push({id,key});return{id};}};
  const items=Array.from({length:10},(_,i)=>({id:String(i),blocked:false,subject:"Hello",body:`Hello ${i}`,purpose:"SERVICE"}));items.push({id:"blocked",blocked:true});items.push({id:"denied",blocked:false,subject:"Hello",body:"denied",purpose:"MARKETING"});
  const result=await queueCustomerEmail(items,"same-batch",adapter);assert.equal(result.queued,10);assert.equal(result.failed,2);assert.ok(max<=4);assert.equal(threads.some(row=>row.contactId==="blocked"),false);assert.equal(new Set(deliveries.map(row=>row.key)).size,10);
  await queueCustomerEmail(items,"same-batch",adapter);assert.equal(seen.size,10);assert.equal(result.results.find(row=>row.id==="denied").code,"COMMUNICATION_CONSENT_REQUIRED");
});
test("new workflows preserve origin/capability checks, preview integrity and existing communication queue",async()=>{
  const api=await source("app/api/customer-email/route.ts");for(const expected of [/mutationIsTrusted/,/requireApiCapability\("messages.manage"\)/,/\.max\(50\)/,/previewHash!==preview.hash/,/new Set\(ids\)/])assert.match(api,expected);
  const repository=await source("lib/customer-email-repository.ts");assert.match(repository,/archived_at=is.null/);assert.match(repository,/do_not_contact/);assert.match(repository,/createCommunicationThread,queueCommunicationMessage/);assert.doesNotMatch(repository,/api.resend|fetch\(/);
});
test("migration guards contact assignment, writes, workspace isolation and relationship evidence remains authoritative",async()=>{
  const sql=await source("db/migrations/202610010083_customer_operations.sql");assert.match(sql,/assigned<>actor/);assert.match(sql,/SALES_DIRECTOR'\)/);assert.match(sql,/customer_subject_access\(p_subject_kind,subject,true\)/);assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/existing.occurred_at<>/);assert.match(sql,/enable row level security/);assert.match(sql,/public.update_school_profile\(/);assert.match(sql,/short_name ilike pattern/);
  const repo=await source("lib/customer-operations-repository.ts");assert.match(repo,/relationship_milestones/);assert.match(repo,/evidence_status=neq.REJECTED/);assert.match(repo,/customer_contract_links/);assert.match(repo,/contracts\?.*household_id/);
  assert.match(repo,/!capabilities.contracts\?Promise.resolve\(\[\] as BusinessRecord\[\]\)/);assert.match(repo,/capabilities.opportunities&&/);
  const api=await source("app/api/customer-operations/route.ts");assert.match(api,/hasCapability\(user.role,"contracts.view"\)/);assert.match(api,/hasCapability\(user.role,"opportunities.view"\)/);
});
test("date view is controllable and searches accept empty/single-character suggestions without second filtering",async()=>{
  const inputs=await source("components/structured-inputs.tsx");assert.match(inputs,/setView\("days"\)/);assert.match(inputs,/dispatchEvent\(new Event\("input"/);assert.match(inputs,/event.stopPropagation\(\)/);
  const panel=await source("components/customer-operations-panel.tsx");assert.doesNotMatch(panel,/\} \*<\/span>/,"required labels rely on the shared marker, without duplicate stars");
  const select=await source("components/ui.tsx");assert.match(select,/onSearch \? options : options.filter/);assert.match(select,/search \? 120 : 0/);assert.match(select,/selectedOption/);
  const search=await source("lib/related-search-repository.ts");assert.doesNotMatch(search,/clean.length\s*<\s*2/);assert.match(search,/types.includes\(type\)/);assert.match(search,/short_name.ilike/);
});
test("family and communications tabs enforce original capability boundaries and preserve old paths",async()=>{
  const [families,messages,tabs]=await Promise.all([source("app/(crm)/households/page.tsx"),source("app/(crm)/messages/page.tsx"),source("components/workspace-tabs.tsx")]);
  assert.match(families,/tab==="students"/);assert.match(families,/requireCapability\("education.view"\)/);
  for(const cap of ["portal.manage","messages.manage","messages.view"])assert.ok(messages.includes(`requireCapability("${cap}")`));assert.match(tabs,/hasCapability\(user.role,item.capability\)/);
});
test("customer contract links target the existing contract workspace and restore query/selection",async()=>{
  const [panel,page,workspace]=await Promise.all([source("components/customer-operations-panel.tsx"),source("app/(crm)/contracts/page.tsx"),source("components/contracts-page.tsx")]);
  assert.match(panel,/contracts\?query=/);assert.doesNotMatch(panel,/href=\{`\/contracts\//);
  assert.match(page,/result\?\.items.some\(item=>item.id===params.focus\)/);assert.match(workspace,/useState\(initialQuery\)/);assert.match(workspace,/useState\(initialSelectedId\)/);
});
test("avatars are decoded, stripped and bounded WebP thumbnails rather than uploaded originals",async()=>{
  const original=await sharp({create:{width:1800,height:900,channels:3,background:{r:120,g:90,b:50}}}).png().toBuffer();
  const compressed=await compressAvatar(original),metadata=await sharp(compressed).metadata();
  assert.equal(metadata.format,"webp");assert.equal(metadata.width,256);assert.equal(metadata.height,128);
  assert.ok(compressed.length<=128*1024);assert.equal(metadata.exif,undefined);
  await assert.rejects(compressAvatar(new Uint8Array([0xff,0xd8,0xff])),/./);
  await assert.rejects(compressAvatar(new Uint8Array(AVATAR_MAX_BYTES+1)),/INVALID_AVATAR/);
});

test("each mail category has two bilingual presets and custom templates require complete language pairs",()=>{
  for(const category of ["FOLLOW_UP","MEETING","PROGRAM"]){
    assert.equal(CUSTOMER_EMAIL_TEMPLATES.filter(id=>id===category||id===`${category}_2`).length,2);
    for(const locale of ["zh-CN","en"]){assert.notEqual(renderCustomerEmail(category,locale,"Name","Owner").body,renderCustomerEmail(`${category}_2`,locale,"Name","Owner").body);}
  }
  const custom={subjectZh:"您好 {{name}}",subjectEn:"",bodyZh:"负责对接人 {{owner}}",bodyEn:"",purpose:"MARKETING"};
  assert.equal(customEmailSchema.safeParse(custom).success,true);
  assert.equal(customEmailSchema.safeParse({...custom,subjectEn:"Only subject"}).success,false);
  assert.equal(customEmailSchema.safeParse({...custom,subjectZh:"\r\nInjected"}).success,false);
  assert.equal(customEmailSchema.safeParse({...custom,bodyZh:"{{secret}}"}).success,false);
  const rendered=renderCustomerEmail("CUSTOM","en","Alex {{owner}}","Staff",custom);
  assert.equal(rendered.subject,"您好 Alex {{owner}}");assert.equal(rendered.body,"负责对接人 Staff");assert.equal(rendered.purpose,"MARKETING");
  const preview={items:[],hash:"hash",locale:"zh-CN",template:"CUSTOM",customTemplate:custom};
  const retry=customerEmailBatchPayload("queue",["person"],"FOLLOW_UP","en","key",preview,{...custom,bodyZh:"changed"});
  assert.equal(retry.template,"CUSTOM");assert.equal(retry.customTemplate.bodyZh,custom.bodyZh);
});

test("four import resources share complete field registries with quoted examples and per-field guides",()=>{
  for(const [resource,fields] of Object.entries(importFieldsByResource)){
    const example=parseCsvDocument(buildImportTemplate(resource,"example","zh-CN",key=>key));
    assert.deepEqual(example.headers,[...fields]);assert.equal(example.rows.length,1);
    for(const field of fields){assert.ok(Object.hasOwn(importExamples,field),field);assert.ok(importFieldFormat(field,true));}
    const guide=parseCsvDocument(buildImportTemplate(resource,"guide","en",key=>key));
    assert.equal(guide.rows.length,fields.length);assert.deepEqual(guide.rows.map(row=>row.field),[...fields]);
    assert.equal(buildImportTemplate(resource,"blank","en",key=>key).split("\r\n").length,2);
  }
  const school=parseCsvDocument(buildImportTemplate("ORGANIZATIONS","example","en",key=>key));
  assert.equal(school.rows[0].courseCategories,"语言,科学");
  const student=parseCsvDocument(buildImportTemplate("STUDENTS","example","en",key=>key));
  assert.equal(student.rows[0].personId,"REPLACE_WITH_EXISTING_CONTACT_UUID");
});

test("personalization overflow is blocked in the actual preview adapter before queueing",async()=>{
  const read=async()=>[{id:"person",name_zh:"长".repeat(160),name_en:"Long".repeat(40),email:"customer@example.test",owner_id:null,do_not_contact:false}];
  const custom={subjectZh:"{{name}}{{name}}",subjectEn:"",bodyZh:"{{name}}".repeat(70),bodyEn:"",purpose:"SERVICE"};
  assert.equal(customEmailSchema.safeParse(custom).success,true);
  const preview=await previewCustomerEmail(["person"],"CUSTOM","zh-CN",custom,read);
  assert.equal(preview.items[0].blocked,true);assert.equal(preview.items[0].blockedReason,"INVALID_TEMPLATE_CONTENT");
  let sent=false;const result=await queueCustomerEmail(preview.items,"key",{createThread:async()=>{sent=true;},queueMessage:async()=>{sent=true;}});
  assert.equal(sent,false);assert.equal(result.queued,0);
});

test("queue snapshot preserves IDs, key and personalized template after unknown outcomes",()=>{
  const ids=["one","two"],custom={subjectZh:"您好",subjectEn:"",bodyZh:"{{name}}",bodyEn:"",purpose:"SERVICE"};
  const preview={items:[],hash:"a".repeat(64),locale:"zh-CN",template:"CUSTOM",customTemplate:custom};
  const frozen=freezeCustomerEmailBatch(ids,"CUSTOM","zh-CN","same-request",preview);
  ids.push("three");custom.bodyZh="changed";preview.hash="changed";
  assert.deepEqual(frozen.contactIds,["one","two"]);assert.equal(frozen.customTemplate.bodyZh,"{{name}}");
  assert.equal(frozen.requestKey,"same-request");assert.equal(frozen.previewHash,"a".repeat(64));
});

test("preview uses authoritative eligibility for service and marketing without exposing consent evidence",async()=>{
  for(const [template,purpose] of [["PROGRAM","MARKETING"],["FOLLOW_UP","SERVICE"]]){
    const calls=[];const read=async(path,init)=>{
      calls.push(path);
      if(path.includes("eligibility")){assert.equal(JSON.parse(init.body).message_purpose,purpose);return[{id:"allowed",allowed:true},{id:"denied",allowed:false}];}
      return ["allowed","denied"].map(id=>({id,name_zh:"客户",email:"person@example.test",owner_id:null,do_not_contact:false}));
    };
    const result=await previewCustomerEmail(["allowed","denied"],template,"zh-CN",undefined,read);
    assert.equal(result.items[0].blocked,false);assert.equal(result.items[1].blocked,true);
    assert.equal(result.items[1].blockedReason,"COMMUNICATION_CONSENT_REQUIRED");
    assert.equal(calls.filter(path=>path.includes("eligibility")).length,1);
    let writes=0;const queue=await queueCustomerEmail([result.items[1]],"same-request",{createThread:async()=>{writes++;},queueMessage:async()=>{writes++;}});
    assert.equal(writes,0);assert.equal(queue.results[0].code,"COMMUNICATION_CONSENT_REQUIRED");
  }
});

test("template writes require a stable UUID and explicit revision, and archive is versioned",()=>{
  const content={subjectZh:"您好",subjectEn:"",bodyZh:"正文",bodyEn:"",purpose:"SERVICE"},id="00000000-0000-4000-8000-000000000001";
  assert.equal(savedEmailSchema.safeParse({id,expectedRevision:null,name:"新建",content}).success,true);
  assert.equal(savedEmailSchema.safeParse({id,expectedRevision:1,name:"更新",content}).success,true);
  for(const expectedRevision of [undefined,0,-1,1.5,"1"])assert.equal(savedEmailSchema.safeParse({id,expectedRevision,name:"模板",content}).success,false);
  assert.equal(savedEmailSchema.safeParse({expectedRevision:null,name:"模板",content}).success,false);
  assert.equal(archiveEmailSchema.safeParse({operation:"archive",id,expectedRevision:1}).success,true);
  assert.equal(archiveEmailSchema.safeParse({operation:"archive",id,expectedRevision:null}).success,false);
});

test("inbox guards current thread and inputs; invoker RPCs preserve ownership and narrow eligibility",async()=>{
  const inbox=await source("components/communications-inbox-page.tsx"),hook=await source("hooks/use-remote-search.ts");
  assert.match(inbox,/selectedIdRef.current!==id/);assert.match(inbox,/runThread\(signal=>apiFetch/);
  assert.match(inbox,/disabled=\{pending\|\|threadLoading\}/);assert.match(inbox,/operationLock.current\|\|id===selectedId/);
  assert.match(hook,/AbortSignal.any/);assert.match(hook,/!signal.aborted/);
  const sql=await source("db/migrations/202610020085_email_workflow_integrity.sql");
  assert.match(sql,/security invoker/g);assert.doesNotMatch(sql,/security definer/i);
  assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/owned_by=app_auth.current_user_id\(\)/);
  assert.match(sql,/existing.revision<>expected_revision/);assert.match(sql,/new.revision:=old.revision\+1/);
  assert.match(sql,/public.contact_channel_allowed\(c.id,'EMAIL',message_purpose\)/);assert.match(sql,/cardinality\(contact_ids\) between 1 and 50/);
  assert.doesNotMatch(sql,/delete from|drop table/i);
});

test("import name guidance is resource-specific rather than mentioning students everywhere",()=>{
  for(const resource of ["CONTACTS","ORGANIZATIONS","HOUSEHOLDS"]){
    const guide=parseCsvDocument(buildImportTemplate(resource,"guide","zh-CN",key=>key));
    for(const row of guide.rows.filter(row=>["nameZh","nameEn"].includes(row.field))){assert.match(row["必填要求"],/至少一项/);assert.doesNotMatch(row["必填要求"],/学生/);}
  }
});

test("shared required styling excludes labels with an explicit required marker",async()=>{
  const css=await source("app/globals.css");
  assert.match(css,/:not\(:has\(> span:first-child \.required-indicator\)\)/);
  assert.match(css,/\.field:has\(input\[required\]/);
});

test("email recipient filters are fixed structured selects backed by accessible customer facets",async()=>{
  const picker=await source("components/email-recipient-picker.tsx"),filters=await source("components/recipient-filters.tsx"),css=await source("app/ui-system.css");
  assert.doesNotMatch(picker,/SearchableSelect|three-column/);
  assert.equal((filters.match(/<select value=\{(?:region|tag|type)\}/g)??[]).length,3);
  assert.doesNotMatch(filters,/<input|SearchableSelect/);
  for(const facet of ["regions","tags","types"])assert.match(picker,new RegExp(`${facet}=\\{result\\.${facet}\\}`));
  assert.match(picker,/if\(value===current&&page===1\)return/);assert.match(picker,/setPage\(1\)/);
  assert.match(css,/\.email-recipient-filters \{ grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css,/\.portal-invitation-result \.email-preview \{ overflow-wrap:anywhere; \}/);
  const sql=await source("db/migrations/202610020084_customer_email_templates.sql");
  assert.match(sql,/select distinct city from accessible/);assert.match(sql,/select distinct unnest\(tags\)/);assert.match(sql,/select distinct contact_type from accessible/);
  assert.match(sql,/c.archived_at is null and c.workspace_id=public.current_workspace_id\(\)/);
});

test("portal presets and custom invitations keep safe placeholders, language pairs and bounded validity",()=>{
  for(const content of Object.values(PORTAL_INVITATION_PRESETS)){
    assert.equal(portalTemplateContentSchema.safeParse(content).success,true);
    for(const locale of ["zh-CN","en"]){const rendered=renderPortalInvitation(content,locale,{name:"家长{{portal_url}}",family:"家庭",owner:"顾问",portal_url:"https://example.test/portal/invite/safe",expires:"2026-10-03"});assert.ok(rendered.body.includes("家长{{portal_url}}"));assert.ok(rendered.body.includes("https://example.test/portal/invite/safe"));assert.ok(rendered.body.includes("2026-10-03"));}
  }
  const base=PORTAL_INVITATION_PRESETS.WELCOME;
  for(const content of [{...base,validityDays:0},{...base,validityDays:31},{...base,bodyZh:"无链接"},{...base,bodyEn:"{{unknown}} {{portal_url}}"},{...base,subjectZh:"换\n行"},{...base,bodyZh:"{{portal_url}} https://example.test/portal/invite/"+"a".repeat(43)}])assert.equal(portalTemplateContentSchema.safeParse(content).success,false);
  const oneLanguage={...base,subjectEn:"",bodyEn:""};assert.equal(portalTemplateContentSchema.safeParse(oneLanguage).success,true);
  assert.equal(renderPortalInvitation(oneLanguage,"en",{name:"Name",family:"Family",owner:"Owner",portal_url:"LINK",expires:"DATE"}).subject,base.subjectZh);
});

test("portal templates and recipients preserve origin, capability, category isolation and existing token boundary",async()=>{
  const [api,recipients,repo,email,dialog,workspace,sql]=await Promise.all([source("app/api/portal/templates/route.ts"),source("app/api/portal/recipients/route.ts"),source("lib/portal-template-repository.ts"),source("lib/customer-email-repository.ts"),source("components/portal-invitation-dialog.tsx"),source("components/portal-workspace.tsx"),source("db/migrations/202610020086_portal_invitation_templates.sql")]);
  assert.match(api,/mutationIsTrusted/);assert.match(api,/requireApiCapability\("portal.manage"\)/);assert.match(api,/EMAIL_TEMPLATE_PUBLIC_FORBIDDEN/);
  assert.match(recipients,/requireApiCapability\("portal.manage"\)/);assert.match(repo,/category=eq.PORTAL/);assert.match(email,/category=eq.EMAIL/);
  assert.match(sql,/existing.category<>template_category/);assert.match(sql,/security invoker/g);assert.doesNotMatch(sql,/security definer/i);
  assert.match(sql,/public.household_members/);assert.match(sql,/public.student_guardian_relationships/);assert.match(sql,/h.archived_at is null/);assert.match(sql,/c.archived_at is null/);
  assert.match(dialog,/DateInput/);assert.match(dialog,/!canCreate/);assert.match(workspace,/renderPortalInvitation/);
  assert.doesNotMatch(workspace,/queueCommunicationMessage|localStorage|sessionStorage/);
});
