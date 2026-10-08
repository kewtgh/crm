import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const path='scripts/test-revenue-fulfillment-postgres.mjs',original=readFileSync(path,'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const anchor='  await context(verifier); await accept(ed);';
assert.equal(original.split(anchor).length,2);
const effective=original.replace(anchor,`
  await context(verifier); await assert.rejects(accept(ed),/source_unavailable/);
  await context();
  for(const recipient of [verifier,verifier2])await client.query("select public.share_contact($1,$2,'READ',$3)",[contact,recipient,uuid()]);
  await context(verifier); await accept(ed);
`);
const dir='work/v334/revenue-compatibility';mkdirSync(dir,{recursive:true});
writeFileSync(`${dir}/fulfillment.mjs`,effective);
writeFileSync(`${dir}/manifest.json`,JSON.stringify({historical:path,sha256:hash(original),change:'The owner explicitly shares the student Contact with independent evidence verifiers. First prove an unshared ADMIN peer cannot accept. All historical financial assertions retained.'},null,2));
const result=spawnSync(process.execPath,[`${dir}/fulfillment.mjs`],{stdio:'inherit',windowsHide:true});
assert.equal(hash(readFileSync(path,'utf8')),hash(original));if(result.error)throw result.error;process.exitCode=result.status??1;
