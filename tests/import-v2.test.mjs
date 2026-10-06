import assert from 'node:assert/strict';
import test from 'node:test';
import {readSheet} from 'read-excel-file/node';
import {unzipSync,strFromU8} from 'fflate';
import {v2Resources,v2Headers,v2Fields,normalizeV2Row,validateV2Headers,clearFields} from '../lib/import-v2.ts';
import {buildV2Csv,buildV2Xlsx,v2Example,v2Guide} from '../lib/import-v2-template.ts';
import {parseCsvDocument} from '../lib/csv.ts';
import {normalizeImportSheet} from '../lib/import-sheet.ts';
import {importFieldContract} from '../lib/import-field-contract.ts';
for(const resource of v2Resources){
 test(`${resource} v2 headers and Guide have exact registry coverage`,()=>{
  const fields=importFieldContract.filter(f=>f.resource===resource&&f.support==='SUPPORTED_IMPORT');
  assert.deepEqual(v2Headers(resource),['operation','targetReference',...fields.map(f=>f.key)]);
  assert.deepEqual(v2Guide(resource).slice(1).map(r=>r[0]),v2Headers(resource));
  const example=parseCsvDocument(buildV2Csv(resource,'example'),100,true);
  assert.deepEqual(example.headers,v2Headers(resource));validateV2Headers(resource,example.headers);
  assert.equal(normalizeV2Row(resource,example.rows[0],2).errors.length,0);
  assert.throws(()=>validateV2Headers(resource,[...example.headers,'unknown']),/UNKNOWN_COLUMN/);
  assert.throws(()=>validateV2Headers(resource,example.headers.slice(1)),/TEMPLATE_SCHEMA_INVALID/);
 });
 test(`${resource} real XLSX metadata, examples, enums and server contract`,async()=>{
  const buffer=await buildV2Xlsx(resource,'example');
  const entries=unzipSync(buffer);
  assert.match(strFromU8(entries['xl/workbook.xml']),/name="Metadata"[^>]*state="hidden"/);
  assert.match(strFromU8(entries['xl/worksheets/sheet1.xml']),/dataValidations/);
  const metadata=Object.fromEntries(await readSheet(buffer,'Metadata'));assert.equal(metadata.resource,resource);assert.equal(metadata.template_version,'2');
  const sheet=normalizeImportSheet(await readSheet(buffer,'Data',{parseNumber:v=>v}),100,true);
  assert.deepEqual(sheet.headers,v2Headers(resource));assert.deepEqual(sheet.rows[0],v2Example(resource));
  assert.deepEqual((await readSheet(buffer,'Guide')).slice(1).map(r=>r[0]),v2Headers(resource));
  const blank=await buildV2Xlsx(resource,'blank');assert.deepEqual((await readSheet(blank,'Data'))[0],v2Headers(resource));
 });
}
test('UPDATE blank and missing preserve; explicit clear uses nullable allowlist',()=>{
 const token='ir_'+'a'.repeat(64);
 const row=normalizeV2Row('CONTACTS',{operation:'UPDATE',targetReference:token,title:'',phone:null,notesMarkdown:' ',communicationLevel:'2'},9,'Data');
 assert.deepEqual(row.patch,{communicationLevel:2});assert.equal(row.errors.length,0);
 assert.equal(normalizeV2Row('CONTACTS',{operation:'UPDATE',targetReference:token,phone:'__CLEAR__'},2).patch.phone,null);
 assert.equal(normalizeV2Row('CONTACTS',{operation:'UPDATE',targetReference:token,nameZh:'__CLEAR__'},2).errors[0].code,'CLEAR_NOT_ALLOWED');
 assert.equal(normalizeV2Row('CONTACTS',{operation:'UPDATE',targetReference:token,organizationId:token},2).errors[0].code,'UNSUPPORTED_OPERATION');
 assert.equal(normalizeV2Row('CONTACTS',{operation:'MERGE'},2).errors[0].code,'UNSUPPORTED_OPERATION');
 for(const field of clearFields)assert(v2Resources.some(r=>v2Fields(r).some(f=>f.key===field)),field);
});
test('money is exact string; zero is not blank; locale or float guesses are rejected',()=>{
 assert.equal(normalizeV2Row('HOUSEHOLDS',{nameZh:'Synthetic',annualIncomeAmount:'100000000.01'},2).patch.annualIncomeAmount,'100000000.01');
 assert.equal(normalizeV2Row('HOUSEHOLDS',{nameZh:'Synthetic',annualIncomeAmount:'0'},2).patch.annualIncomeAmount,'0.00');
 assert.equal(normalizeV2Row('HOUSEHOLDS',{nameZh:'Synthetic',annualIncomeAmount:'1e8'},2).errors[0].code,'INVALID_DECIMAL');
 assert.equal(normalizeV2Row('HOUSEHOLDS',{nameZh:'Synthetic',annualIncomeAmount:1},2).errors[0].code,'INVALID_CELL');
});
test('references never accept names/UUIDs; enums and dates have exact format',()=>{
 assert.equal(normalizeV2Row('CONTACTS',{nameZh:'Synthetic',email:'x@example.test',organizationId:'ABC School'},2).errors[0].code,'INVALID_REFERENCE');
 assert.equal(normalizeV2Row('CONTACTS',{nameZh:'Synthetic',email:'x@example.test',contactType:'家长'},2).errors[0].code,'INVALID_ENUM');
 assert.equal(normalizeV2Row('HOUSEHOLDS',{nameZh:'Synthetic','profile.target_intake':'01/02/2027'},2).errors[0].code,'INVALID_DATE');
});
test('blank rows retain physical CSV/XLSX location',()=>{
 assert.deepEqual(parseCsvDocument('nameZh,nameEn\r\n\r\n甲,\r\n\r\n乙,',100,true).rowLocations,[3,5]);
 assert.deepEqual(normalizeImportSheet([['nameZh'],[],['甲'],[],['乙']],100,true).rowLocations,[3,5]);
});
