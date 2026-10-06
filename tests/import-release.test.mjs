import assert from 'node:assert/strict';
import test from 'node:test';
import {readSheet} from 'read-excel-file/node';
import {buildV2Xlsx,buildV2Csv,v2Guide} from '../lib/import-v2-template.ts';
import {v2Resources,v2Headers,v2Fields,v2EnumValues,validateV2Headers,clearFields} from '../lib/import-v2.ts';
import {buildSetTemplate,setGuide} from '../lib/import-set-template.ts';
import {setResources,setHeaders,relationFields,validateSetHeaders} from '../lib/import-set-contract.ts';
import {parseCsvDocument} from '../lib/csv.ts';
const blankHeaders=(csv,headers)=>parseCsvDocument(csv+headers.map((_,i)=>i===0?'CREATE':'').join(',')+'\r\n').headers;
const guideRows=rows=>rows.map(row=>Array.from({length:11},(_,i)=>row[i]??''));

for(const resource of v2Resources){
 test(`${resource}: release blank artifacts, guide sensitivity/clear and exact enum codes`,async()=>{
  const workbook=await buildV2Xlsx(resource,'blank');
  const headers=v2Headers(resource);
  assert.deepEqual(await readSheet(workbook,'Data'),[headers]);
  assert.deepEqual(blankHeaders(buildV2Csv(resource,'blank'),headers),headers);
  assert.deepEqual(guideRows(await readSheet(workbook,'Guide')),v2Guide(resource));
  const enums=(await readSheet(workbook,'Enums')).slice(1).map(r=>[r[0],r[1]]);
  assert.deepEqual(enums,v2Fields(resource).flatMap(f=>v2EnumValues(resource,f).map(code=>[f.key,code])));
  for(const f of v2Fields(resource)){
   const guide=v2Guide(resource).find(r=>r[0]===f.key);
   assert.equal(guide[4],f.update?'YES':'NO');
   assert.equal(guide[7].startsWith('Sensitive'),f.sensitive);
   if(clearFields.has(f.key))assert.match(guide[9],/__CLEAR__ allowed/);
  }
 });
}
for(const resource of setResources){
 test(`${resource}: SET_V1 release blank CSV/XLSX and independent Guide/Enums`,async()=>{
  const headers=setHeaders(resource),workbook=await buildSetTemplate(resource,'blank','xlsx');
  assert.deepEqual(await readSheet(workbook,'Data'),[headers]);
  assert.deepEqual(blankHeaders(await buildSetTemplate(resource,'blank','csv'),headers),headers);
  assert.deepEqual(guideRows(await readSheet(workbook,'Guide')),setGuide(resource));
  if(v2Resources.includes(resource))for(const f of v2Fields(resource))if(clearFields.has(f.key))assert.match(setGuide(resource).find(r=>r[0]===f.key)[9],/__CLEAR__ allowed/);
  const codes=(await readSheet(workbook,'Enums')).slice(1).map(r=>[r[0],r[1]]);
  assert.deepEqual(codes.filter(r=>r[0]==='operation'),['CREATE','UPDATE','SKIP'].map(c=>['operation',c]));
  for(const f of relationFields[resource]??[]){
   if(f.values||f.type==='boolean')assert.deepEqual(codes.filter(r=>r[0]===f.key).map(r=>r[1]),f.values??['true','false']);
   assert.equal(setGuide(resource).find(r=>r[0]===f.key)[7].startsWith('Sensitive'),Boolean(f.sensitive));
  }
 });
}
test('strict protocols reject duplicate columns and fields from another resource',()=>{
 for(const resource of v2Resources)assert.throws(()=>validateV2Headers(resource,[...v2Headers(resource),v2Headers(resource)[0]]),/TEMPLATE_SCHEMA_INVALID/);
 for(const resource of setResources)assert.throws(()=>validateSetHeaders(resource,[...setHeaders(resource),setHeaders(resource)[0]]),/TEMPLATE_SCHEMA_INVALID/);
 assert.throws(()=>validateV2Headers('ORGANIZATIONS',[...v2Headers('ORGANIZATIONS'),'contactType']),/UNKNOWN_COLUMN/);
 assert.throws(()=>validateSetHeaders('HOUSEHOLD_MEMBERS',[...setHeaders('HOUSEHOLD_MEMBERS'),'legalAuthority']),/UNKNOWN_COLUMN/);
});
