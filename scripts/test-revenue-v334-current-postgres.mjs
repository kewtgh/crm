import assert from 'node:assert/strict';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

// CURRENT_SCHEMA: every child provisions its own disposable database. No application env file.
const entries = [
  'test-revenue-upgrade-postgres.mjs',
  'test-revenue-foundation-postgres.mjs',
  'test-revenue-fulfillment-v334-compat-postgres.mjs',
  'test-revenue-candidate-current-compat-postgres.mjs',
  'test-revenue-read-corrections-postgres.mjs',
  'test-revenue-integrated-postgres.mjs',
  'test-revenue-workspace-postgres.mjs',
  'test-commission-postgres.mjs',
];
const dir='work/v334/revenue-current-schema';mkdirSync(dir,{recursive:true});
const results=[];
for(const entry of entries){
  console.log(`CURRENT_SCHEMA start ${entry}`);
  const source=readFileSync(`scripts/${entry}`);
  const result=spawnSync(process.execPath,[`scripts/${entry}`],{
    encoding:'utf8',windowsHide:true,timeout:150000,maxBuffer:8*1024*1024,
    env:{...process.env,COMMISSION_TEST_POSTGRES_IMAGE:process.env.REVENUE_TEST_POSTGRES_IMAGE||'postgres:18.4-bookworm'},
  });
  writeFileSync(`${dir}/${entry}.log`,`${result.stdout||''}\n${result.stderr||''}`);
  results.push({entry,sha256:createHash('sha256').update(source).digest('hex'),exitCode:result.status,error:result.error?.code});
  writeFileSync(`${dir}/results.json`,JSON.stringify({mode:'CURRENT_SCHEMA',results},null,2));
  assert.deepEqual(readFileSync(`scripts/${entry}`),source,'Historical entry changed during execution');
  if(result.error||result.status!==0){console.error(result.stdout,result.stderr);throw result.error||new Error(`${entry} failed`);}
  console.log(`CURRENT_SCHEMA PASS ${entry}`);
}
console.log('REVENUE_CURRENT_SCHEMA_POSTGRES_PASS');
