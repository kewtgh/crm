import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { followUpProgress } from "../lib/customer-operations.ts";
import { CUSTOMER_EMAIL_TEMPLATES,renderCustomerEmail } from "../lib/customer-email-templates.ts";
import { queueCustomerEmail } from "../lib/customer-email-repository.ts";
const source=file=>readFile(new URL(`../${file}`,import.meta.url),"utf8");
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
  for(const template of CUSTOMER_EMAIL_TEMPLATES)for(const locale of ["zh-CN","en"]){const result=renderCustomerEmail(template,locale,"客户{{name}}","负责{{owner}}");assert.ok(result.body.includes("客户{{name}}"));assert.ok(result.body.includes("负责{{owner}}"));assert.ok(result.subject.length>=2);assert.equal(result.purpose,template==="PROGRAM"?"MARKETING":"SERVICE");}
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
  const repo=await source("lib/customer-operations-repository.ts");assert.match(repo,/relationship_milestones/);assert.match(repo,/evidence_status=neq.REJECTED/);assert.match(repo,/customer_contract_links/);assert.doesNotMatch(repo,/contracts\?.*household_id/);
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
