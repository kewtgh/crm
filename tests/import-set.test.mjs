import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {unzipSync,strFromU8} from 'fflate';
import {readSheet} from 'read-excel-file/node';
import {relationResources,setResources,setHeaders,relationFields,normalizeSetRow,validateSetHeaders,parseAlias,validateSetReference,dependencyGraph,setActionSchema} from '../lib/import-set-contract.ts';
import {buildSetTemplate,setExample,setGuide} from '../lib/import-set-template.ts';
import {v2Headers} from '../lib/import-v2.ts';
import {parseCsvDocument} from '../lib/csv.ts';

for(const resource of setResources){
 test(`${resource}: exact independent schema, CSV/XLSX, metadata, guide and enum parity`,async()=>{
  const headers=setHeaders(resource);assert.equal(new Set(headers).size,headers.length);validateSetHeaders(resource,headers);
  assert.throws(()=>validateSetHeaders(resource,[...headers,'unknown']),/UNKNOWN_COLUMN/);assert.throws(()=>validateSetHeaders(resource,headers.slice(1)),/TEMPLATE_SCHEMA_INVALID/);
  const csv=await buildSetTemplate(resource,'example','csv');assert.deepEqual(parseCsvDocument(csv).headers,headers);
  const xlsx=await buildSetTemplate(resource,'example','xlsx');assert.deepEqual((await readSheet(xlsx,'Data'))[0],headers);assert.deepEqual(await readSheet(xlsx,'Metadata'),[['resource',resource],['template_version','SET_V1']]);
  const archive=unzipSync(xlsx);assert.match(strFromU8(archive['xl/workbook.xml']),/name="Metadata"[^>]*state="hidden"/);
  assert.deepEqual(setGuide(resource).slice(1).map(r=>r[0]),headers);
  for(const f of relationFields[resource]??[])assert.ok(f.column&&f.type&&f.key);
  assert.deepEqual(normalizeSetRow(resource,setExample(resource),2).errors,[]);
 });
}
test('standalone v2 headers unchanged; set alias version explicit',()=>{assert.ok(!v2Headers('CONTACTS').includes('alias'));assert.ok(setHeaders('CONTACTS').includes('alias'));for(const resource of relationResources)assert.ok(!setHeaders(resource).includes('alias'));});
test('typed alias never resolves a different resource or arbitrary name',()=>{assert.equal(parseAlias('@contact:alice').kind,'CONTACT');assert.throws(()=>parseAlias('@contact:alice','ORGANIZATION'),/INVALID_REFERENCE/);for(const value of ['Alice','alice@example.test','00000000-0000-4000-8000-000000000001','@contact:Alice'])assert.throws(()=>validateSetReference(value,'CONTACT'),/INVALID_REFERENCE/);});
test('DAG orders aliases; rejects missing, duplicate and cyclic definitions',()=>{
 const org={id:'org',resource:'ORGANIZATIONS',row:normalizeSetRow('ORGANIZATIONS',{alias:'@organization:a',nameZh:'A',city:'Taipei'},2)},contact={id:'contact',resource:'CONTACTS',row:normalizeSetRow('CONTACTS',{alias:'@contact:a',nameZh:'A',email:'a@example.test',organizationId:'@organization:a'},2)};
 assert.deepEqual(dependencyGraph([contact,org]).order,['org','contact']);assert.throws(()=>dependencyGraph([contact]),/INVALID_REFERENCE/);assert.throws(()=>dependencyGraph([org,{...org,id:'other'}]),/ALIAS_CONFLICT/);
 const two={id:'org2',resource:'ORGANIZATIONS',row:normalizeSetRow('ORGANIZATIONS',{alias:'@organization:b',nameZh:'B',city:'Taipei',parentOrganizationId:'@organization:a'},2)};org.row=normalizeSetRow('ORGANIZATIONS',{alias:'@organization:a',nameZh:'A',city:'Taipei',parentOrganizationId:'@organization:b'},2);assert.throws(()=>dependencyGraph([org,two]),/DEPENDENCY_CYCLE/);
});
test('UPDATE blank retains only explicit values; legal authority false is explicit',()=>{const row=normalizeSetRow('STUDENT_GUARDIANS',{operation:'UPDATE',studentReference:'@student:a',guardianContactReference:'@contact:b',legalAuthority:'false',primaryGuardian:''},9,'Data');assert.deepEqual(row.errors,[]);assert.equal(row.patch.legal_authority,false);assert.ok(!('primary_guardian' in row.patch));assert.equal(row.location.row,9);assert.ok(normalizeSetRow('STUDENT_GUARDIANS',{studentReference:'@student:a',guardianContactReference:'@contact:b',relationship:'MOTHER'},2).errors.some(e=>e.field==='legalAuthority'));});
test('relationship rules do not accept unknown types, MERGE, clear or guessed PARENT',()=>{assert.ok(normalizeSetRow('STUDENT_GUARDIANS',{studentReference:'@student:a',guardianContactReference:'@contact:b',relationship:'PARENT',legalAuthority:'true'},2).errors.some(e=>e.code==='INVALID_ENUM'));assert.ok(normalizeSetRow('HOUSEHOLD_MEMBERS',{operation:'MERGE',householdReference:'@household:a',contactReference:'@contact:b',memberRole:'__CLEAR__'},2).errors.some(e=>e.code==='UNSUPPORTED_OPERATION'));assert.ok(normalizeSetRow('HOUSEHOLD_MEMBERS',{householdReference:'@household:a',contactReference:'@contact:b',memberRole:'__CLEAR__'},2).errors.some(e=>e.code==='CLEAR_NOT_ALLOWED'));});
test('entity exact decimals, blank/clear and Contact association restrictions remain intact',()=>{assert.equal(normalizeSetRow('HOUSEHOLDS',{nameZh:'Family',annualIncomeAmount:'100000000.01'},2).patch.annualIncomeAmount,'100000000.01');const token='ir_'+'a'.repeat(64);assert.deepEqual(normalizeSetRow('CONTACTS',{operation:'UPDATE',targetReference:token,title:'',phone:'__CLEAR__'},2).patch,{phone:null});assert.ok(normalizeSetRow('CONTACTS',{operation:'UPDATE',targetReference:token,organizationId:'@organization:a'},2).errors.some(e=>e.code==='UNSUPPORTED_OPERATION'));});
test('strict action bounds reject arbitrary fields and unbounded files',()=>{assert.equal(setActionSchema.safeParse({operation:'executeSet',setId:'00000000-0000-4000-8000-000000000001',expectedRevision:1,limit:101}).success,false);assert.equal(setActionSchema.safeParse({operation:'createSet',name:'Set',requestKey:'12345678',workspaceId:'foreign'}).success,false);});
test('SQL relation field catalog is identical to typed registry; public writes are gated',()=>{const sql=readFileSync(new URL('../db/migrations/202610060112_import_sets_relationship_reliability.sql',import.meta.url),'utf8');const embedded=sql.match(/import_relation_catalog\(\).*?select '(.*?)'::jsonb/s)[1];assert.deepEqual(JSON.parse(embedded),relationFields);assert.match(sql,/operation='UPDATE' and \(expected is null/);assert.match(sql,/import_set_id is null/);assert.match(sql,/purge_expired_import_v2_evidence_before112/);});
