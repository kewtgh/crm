import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Populate real legacy owners using the existing fictional Finance/Commission suite at 114.
// Only the private generated harness changes; historical scripts and SQL remain untouched.
const dir='work/revenue-r5g/upgrade';mkdirSync(dir,{recursive:true});
const migrator=readFileSync('scripts/db-migrate.mjs','utf8');
const bounded=migrator.replace('path.resolve(import.meta.dirname, "..", "db", "migrations")','path.resolve("db/migrations")')
  .replace('.sort();','.filter(name => name < "202610070115_").sort();');
assert.notEqual(bounded,migrator);writeFileSync(`${dir}/migrate-114.mjs`,bounded);
const path='scripts/test-commission-postgres.mjs',original=readFileSync(path,'utf8');
const anchor=" console.log('PASS commission PostgreSQL:";
assert.equal(original.split(anchor).length,2);
const checks=String.raw`
 await client.query('reset role');
 const owners=['products','contracts','contract_versions','payments','refunds','student_enrollments','commission_accruals','commission_settlements'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(owners.map(async table=>[table,(await client.query('select coalesce(jsonb_agg(to_jsonb(t) order by id),\'[]\'::jsonb) rows from public.'+table+' t')).rows[0].rows])));
 const before=await snapshot();
 for(const table of owners)assert.ok(before[table].length>0,'Legacy fixture missing '+table);
 assert.equal((await client.query("select to_regclass('public.recognized_revenue_facts') x")).rows[0].x,null);
 run(process.execPath,['scripts/db-migrate.mjs'],env);
 const after=await snapshot();
 for(const row of after.payments){assert.equal(row.purpose,'TRADE_RECEIPT');for(const key of Object.keys(row))if(!(key in before.payments[0]))delete row[key];}
 // Revenue acceptance columns must be null/default, never guessed; compare all legacy columns.
 for(const table of owners)for(const row of after[table])for(const key of Object.keys(row))if(!(key in before[table][0])){assert.ok(row[key]===null||row[key]===false,'Unexpected guessed lineage: '+table+'.'+key);delete row[key];}
 assert.deepEqual(after,before,'Upgrade changed legacy business records');
 for(const table of ['revenue_reporting_profiles','revenue_authority_assignments','revenue_policy_versions','contract_specified_services','revenue_service_bindings','revenue_fulfillment_attestations','revenue_recognition_candidates','recognized_revenue_facts','cash_applications'])assert.equal((await client.query('select count(*)::int n from public.'+table)).rows[0].n,0,'Unexpected Revenue backfill: '+table);
 await context();
 const read=(await client.query('select public.revenue_workspace_read(null,null,1) x')).rows[0].x;
 assert.equal(read.state,'NO_CONFIGURATION');
 console.log('PASS UPGRADE 114 -> 120: legacy financial rows preserved, trade purpose default only, no Revenue facts or automatic configuration');
`;
const effective=original.replace('Date.now()+50_000','Date.now()+90000')
 .replace('["scripts/db-migrate.mjs"],env)',`["${dir}/migrate-114.mjs"],env)`)
 .replace(anchor,checks+anchor);
writeFileSync(`${dir}/upgrade.mjs`,effective);
const result=spawnSync(process.execPath,[`${dir}/upgrade.mjs`],{stdio:'inherit',windowsHide:true,env:{...process.env,COMMISSION_TEST_POSTGRES_IMAGE:process.env.REVENUE_TEST_POSTGRES_IMAGE||'postgres:18.4-bookworm'}});
assert.equal(readFileSync(path,'utf8'),original);assert.equal(readFileSync('scripts/db-migrate.mjs','utf8'),migrator);
if(result.error)throw result.error;process.exitCode=result.status??1;
