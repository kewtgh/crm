import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const path='scripts/test-revenue-fact-postgres.mjs',original=readFileSync(path,'utf8');
const anchor='  const closeTarget=await prepare("CLOSE_RACE");';
assert.equal(original.split(anchor).length,2);
const checks=String.raw`
 await context();const apiService=await service('HTTP_INTEGRATION');await evidence(apiService);
 await context(maker,ws,'aal2',null);
 await client.query("update app_auth.accounts set status='ACTIVE',email_confirmed_at=now(),must_change_password=false where id=any($1::uuid[])",[[maker,verifier,poster,plain]]);
 await client.query("update public.workspace_memberships set status='ACTIVE',must_change_password=false where user_id=any($1::uuid[])",[[maker,verifier,poster,plain]]);
 await client.query("insert into public.user_profiles(user_id,username,display_name_zh,display_name_en) select id,username,'示例操作员','Example operator' from app_auth.accounts where id=any($1::uuid[]) on conflict(user_id) do nothing",[[maker,verifier,poster,plain]]);
 const apiEnv={...env,NODE_ENV:'test',DATABASE_URL:'postgresql://crm_app:'+env.CRM_APP_DB_PASSWORD+'@127.0.0.1:'+port+'/revenue_test',SYSTEM_DATABASE_URL:'postgresql://crm_system:'+env.CRM_SYSTEM_DB_PASSWORD+'@127.0.0.1:'+port+'/revenue_test',WORKER_DATABASE_URL:'postgresql://crm_worker:'+env.CRM_WORKER_DB_PASSWORD+'@127.0.0.1:'+port+'/revenue_test',REVENUE_DISPOSABLE_API_FIXTURE:JSON.stringify({entity,service:apiService.s.id,binding:apiService.b.id,users:{maker,reviewer:verifier,poster,plain,aal1:poster}})};
 console.log(run(process.execPath,['--import','tsx','scripts/test-revenue-api-current.mjs'],apiEnv));
 await context(maker,ws,'aal2',null);
 for(const role of ['crm_app','crm_system','crm_worker'])for(const table of ['revenue_policy_versions','contract_specified_services','revenue_service_bindings','revenue_fulfillment_attestations','revenue_recognition_candidates','recognized_revenue_facts','cash_applications'])for(const action of ['INSERT','UPDATE','DELETE'])assert.equal((await one('select has_table_privilege($1,$2,$3) allowed',[role,'public.'+table,action])).allowed,false,role+' '+table+' '+action);
 const security=(await client.query("select proname,proconfig,has_function_privilege('crm_system',p.oid,'EXECUTE') system_allowed,has_function_privilege('crm_worker',p.oid,'EXECUTE') worker_allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('revenue_workspace_read','revenue_source_options','revenue_ui_health','revenue_ui_contract_read')")).rows;
 assert.equal(security.length,4);for(const row of security){assert.ok(row.proconfig.some(x=>x.startsWith('search_path=')));assert.equal(row.system_allowed,false);assert.equal(row.worker_allowed,false);}
 await client.query("insert into public.workspace_memberships(workspace_id,user_id,role) values($1,$2,'ADMIN')",[otherWs,maker]);
 await context();const canonical=(await one('select public.current_workspace_id() id')).id;
 await context(maker,canonical===ws?otherWs:ws);assert.equal((await one('select public.revenue_workspace_id() id')).id,null);await assert.rejects(one('select public.revenue_workspace_read($1) x',[entity]),/authority_required/);
 await context(maker,ws,'aal2',null);await client.query('delete from public.workspace_memberships where workspace_id=$1 and user_id=$2',[otherWs,maker]);
 console.log('PASS CURRENT_SCHEMA direct-write privilege matrix, read SECURITY DEFINER scope/grants, real multi-membership mismatch fail-closed');
 // Exercise pagination against real governed rows rather than bypassing immutable inserts.
 for(let i=0;i<105;i++){const item=await prepare('PAGING_'+i);await context(poster);await post(item.c);}
 await context();const started=performance.now();const page1=(await one('select public.revenue_workspace_read($1,null,1) x',[entity])).x;
 const page2=(await one('select public.revenue_workspace_read($1,null,2) x',[entity])).x;
 const contractView=(await one('select public.revenue_workspace_read($1,$2,1) x',[entity,contract.id])).x;
 assert.equal(page1.facts.length,100);assert.ok(page2.facts.length>0);assert.ok(page1.queue.length<=25);assert.ok(page2.queue.length<=25);assert.ok(!page2.facts.some(f=>page1.facts.some(first=>first.id===f.id)));assert.ok(contractView.facts.length<=100);
 for(const row of page1.queue)if(row.fact_id)assert.deepEqual(row.actions,[]);
 const elapsed=performance.now()-started;assert.ok(elapsed<15000,'Three bounded projections exceeded 15 seconds');console.log('PASS bounded read sanity: 105 additional governed facts, queue 25/history 100, disjoint pages, three projections ms='+Math.round(elapsed));
`;
let effective=original.replace('Date.now() + 90_000','Date.now() + 120_000').replace(anchor,checks+anchor);
const obsolete=`assert.equal((await one("select to_regclass('public.cash_applications') x")).x,null);`;assert.equal(effective.split(obsolete).length,2);
effective=effective.replace(obsolete,`assert.equal((await one("select to_regclass('public.cash_applications') x")).x,'cash_applications');`).replace('and no cash-application owner','and current cash owner').replace('REVENUE_R5D_POSTGRES_PASS','REVENUE_R5G_INTEGRATED_POSTGRES_PASS');
const dir='work/revenue-r5g/integrated';mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/current.mjs`,effective);
const result=spawnSync(process.execPath,[`${dir}/current.mjs`],{stdio:'inherit',windowsHide:true});assert.equal(readFileSync(path,'utf8'),original);if(result.error)throw result.error;process.exitCode=result.status??1;
