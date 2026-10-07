import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
// Reuse the disposable fixture lifecycle without editing the historical suite.
const path='scripts/test-cash-application-postgres.mjs';
const original=readFileSync(path,'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const anchor='  console.log("REVENUE_R5E_POSTGRES_PASS");';
assert.equal(original.split(anchor).length,2);
const checks=String.raw`
  const workspaceRead=async(ent=entity,contractId=null,page=1,filters={})=>(await one('select public.revenue_workspace_read($1,$2,$3,$4) x',[ent,contractId,page,filters])).x;
  await context();
  const readContract=(await client.query("select * from public.create_buyer_contract('EX-READ-SEPARATION',$1,null,$2,'2026-01-01','2026-12-31','CNY',1000)",[org,product])).rows[0];
  const readVersion=await one('select id,version from public.contract_versions where contract_id=$1 order by version desc limit 1',[readContract.id]);
  await foundation('CONTRACT_ACCEPT',readVersion.id,{reference:'EX-READ-ACCEPTED'},readVersion.version);
  const readService=await service('READ_SEPARATION',undefined,undefined,[a],true,undefined,{contract:readContract,cv:readVersion,accepted:'400.00',currency:'CNY'});
  const readSchedule=(await client.query('select * from public.save_receivable_schedule($1,$2)',[readContract.id,JSON.stringify([{dueDate:'2026-01-01',amount:'1000.00'}])])).rows[0];
  await client.query("select public.record_payment($1,$2,700,'CNY','EX-READ-TRADE',now())",[readContract.id,readSchedule.id]);
  await evidence(readService);const rc=await approved(await evaluate(readService));await context(poster);await post(rc);await context();
  const separate=await workspaceRead(entity,readContract.id);assert.equal(separate.contracts[0].contracted,'1000.00');assert.equal(separate.contracts[0].receivable,'1000.00');assert.equal(separate.contracts[0].collected,'700.00');assert.equal(separate.recognized[0].amount,'400.00');
  const custodyRead=await target('READ_CUSTODY','80.00');await evidence(custodyRead);const cc=await approved(await evaluate(custodyRead));await context(poster);await post(cc);await context();const cp=await receipt(custodyRead);await apply(cp,custodyRead,'60.00');
  const separatedCash=await workspaceRead(entity,custodyRead.contract.id);assert.equal(separatedCash.recognized[0].amount,'80.00');assert.equal(separatedCash.cash[0].amount,'100.00');assert.equal(separatedCash.cash[0].applied,'60.00');assert.equal(separatedCash.cash[0].available,'40.00');
  console.log('PASS R5F real projections: Contract 1000 / Receivable 1000 / Collected 700 / Revenue 400; custody 100 / applied 60 / available 40 / Revenue 80');
  await context();const read=await workspaceRead();assert.equal(read.state,'READY');
  assert.ok(read.queue.length<=25);assert.ok(read.facts.length<=100);assert.ok(read.bindings.length<=100);
  for(const row of read.recognized){assert.equal(typeof row.amount,'string');const expected=await one('select sum(amount)::numeric(14,2)::text amount from public.recognized_revenue_facts where reporting_entity_id=$1 and currency=$2',[entity,row.currency]);assert.equal(row.amount,expected.amount);}
  for(const row of read.queue){assert.equal(typeof row.amount,'string');if(row.fact_id||row.health!=='CURRENT')assert.ok(!row.actions.includes('POST'));if(row.created_by===maker||row.reviewed_by===maker)assert.ok(!row.actions.includes('POST'));}
  assert.ok(read.cash.length>0);for(const row of read.cash){assert.equal(typeof row.available,'string');assert.ok(Array.isArray(row.targets));}
  const scoped=await workspaceRead(entity,cashFirst.contract.id);assert.equal(scoped.recognized[0].amount,'100.00');assert.equal(scoped.contracts[0].applied_cash,'100.00');assert.equal(scoped.contracts[0].collected,'100.00');
  const options=(await one('select public.revenue_source_options($1,$2) x',[entity,cashFirst.s.id])).x;assert.ok(options.length>0);assert.ok(options.every(x=>Object.keys(x).sort().join(',')==='condition,date,domain,id'));
  const qualifying=(await one('select public.revenue_source_options($1,$2,$3) x',[entity,cashFirst.s.id,cashFirst.b.id])).x;assert.ok(qualifying.length>0);assert.ok(qualifying.every(x=>x.unit==='DELIVERABLE'&&x.business_date));
  await context(maker,ws,'aal2',null);await client.query("update public.contracts set status='CANCELLED' where id=$1",[cashFirst.contract.id]);await context();
  const retained=await workspaceRead(entity,cashFirst.contract.id);assert.equal(retained.recognized[0].amount,'100.00');assert.equal(retained.facts.find(f=>f.id===laterFact.id).amount,'100.00');assert.equal(retained.cash.length,0,'inapplicable cash sources are not actionable');
  console.log('PASS cancelled Contract retains authorized immutable Revenue history and does not remain a cash target');
  await context(poster);const postingRead=await workspaceRead();assert.equal(postingRead.state,'READY');assert.equal(postingRead.cash.length,0);assert.ok(postingRead.queue.length>0,'poster can review exact candidate basis via bounded projection');assert.ok(!postingRead.can_create_policy);
  await context(plain);assert.equal((await workspaceRead(null)).state,'NO_DESIGNATION');await assert.rejects(workspaceRead(entity),/authority_required/);
  await context(superAdmin);assert.equal((await workspaceRead(null)).state,'NO_DESIGNATION');
  await context(maker,otherWs);await assert.rejects(workspaceRead(entity),/authority_required/);
  await context();await assert.rejects(workspaceRead(uuid()),/authority_required/);await assert.rejects(workspaceRead(entity,null,0),/input_invalid/);
  await assert.rejects(client.query('select public.revenue_ui_health($1)',[laterCandidate.id]),/permission denied/);
  console.log('REVENUE_R5F_POSTGRES_PASS: bounded reads, exact currency aggregates, designation, three actors, posted exclusion, cash separation');
`;
const directory='work/revenue-r5f/postgres';mkdirSync(directory,{recursive:true});
writeFileSync(`${directory}/read-models.mjs`,original.replace(anchor,checks));
writeFileSync(`${directory}/manifest.json`,JSON.stringify({source:path,sha256:hash(original),fixtureAssertionsUnchanged:true},null,2));
const result=spawnSync(process.execPath,[`${directory}/read-models.mjs`],{stdio:'inherit',windowsHide:true});
assert.equal(hash(readFileSync(path,'utf8')),hash(original));if(result.error)throw result.error;process.exitCode=result.status??1;
