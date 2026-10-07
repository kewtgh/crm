import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const path='scripts/test-revenue-candidate-postgres.mjs',original=readFileSync(path,'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');let effective=original;
for(const table of ['recognized_revenue_facts','cash_applications']){
 const old=`assert.equal((await one("select to_regclass('public.${table}') x")).x,null);`;
 assert.equal(effective.split(old).length,2);effective=effective.replace(old,`assert.equal((await one("select to_regclass('public.${table}') x")).x,"${table}");`);
}
effective=effective.replace('and no posting owners','and current-schema owner boundaries').replace('REVENUE_R5C_POSTGRES_PASS','REVENUE_R5C_CURRENT_COMPAT_POSTGRES_PASS');
const dir='work/revenue-r5f/compatibility';mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/r5c-current.mjs`,effective);writeFileSync(`${dir}/r5c-manifest.json`,JSON.stringify({historical:path,sha256:hash(original),changes:'Only superseded absence assertions; financial assertions unchanged'},null,2));
const result=spawnSync(process.execPath,[`${dir}/r5c-current.mjs`],{stdio:'inherit',windowsHide:true});assert.equal(hash(readFileSync(path,'utf8')),hash(original));if(result.error)throw result.error;process.exitCode=result.status??1;
