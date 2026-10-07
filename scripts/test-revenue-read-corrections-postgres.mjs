import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const path='scripts/test-revenue-fact-postgres.mjs',original=readFileSync(path,'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const obsolete=`assert.equal((await one("select to_regclass('public.cash_applications') x")).x,null);`;
assert.equal(original.split(obsolete).length,2);
const anchor='  await revise(corrected,"120.00");';assert.equal(original.split(anchor).length,2);
const checks=String.raw`
  const projection=(await one('select public.revenue_workspace_read($1,$2,1) x',[entity,contract.id])).x;
  assert.equal(projection.facts.find(f=>f.id===root.id).amount,'100.00');
  assert.equal(projection.facts.find(f=>f.id===root.id).current_amount,'70.00');
  assert.equal(projection.facts.find(f=>f.id===reversal.id).amount,'-30.00');
  for(const total of projection.recognized){assert.equal(total.amount,(await one('select sum(amount)::numeric(14,2)::text amount from public.recognized_revenue_facts where contract_id=$1 and currency=$2',[contract.id,total.currency])).amount);}
  console.log('PASS R5F correction read: original 100 and reversal -30 remain separate; aggregate includes both');
`;
const effective=original.replace(obsolete,`assert.equal((await one("select to_regclass('public.cash_applications') x")).x,"cash_applications");`).replace(anchor,checks+anchor).replace('and no cash-application owner','and the current R5E cash owner boundary').replace('REVENUE_R5D_POSTGRES_PASS','REVENUE_R5F_CORRECTION_READ_POSTGRES_PASS');
const dir='work/revenue-r5f/compatibility';mkdirSync(dir,{recursive:true});writeFileSync(`${dir}/r5d-reads.mjs`,effective);
const result=spawnSync(process.execPath,[`${dir}/r5d-reads.mjs`],{stdio:'inherit',windowsHide:true});assert.equal(hash(readFileSync(path,'utf8')),hash(original));if(result.error)throw result.error;process.exitCode=result.status??1;
