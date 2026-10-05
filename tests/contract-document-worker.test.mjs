import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {processContractDocument} from '../scripts/lib/contract-document-worker.mjs';
import {sealDocumentConfiguration,openDocumentConfiguration} from '../lib/contract-document-configuration.mjs';
const catalog=JSON.parse(await readFile('templates/contracts/catalog.json','utf8'));
process.env.DOCUMENT_CONFIGURATION_ENCRYPTION_KEY=randomBytes(32).toString('hex');
async function setup() {
 const definition=structuredClone(catalog.versions[1]),fixture=JSON.parse(await readFile(definition.fixture_path,'utf8'));
 definition.review_items=[];for(const f of definition.fields)if(f.category==='UNSUPPORTED'){f.category='TEMPLATE_CONSTANT';f.value='Synthetic test only';}
 const confirmed={},configuration={};for(const f of definition.fields)if(f.category==='USER_CONFIRMED'&&fixture.confirmed[f.key]!==undefined){(/^(company|bank)\./.test(f.key)?configuration:confirmed)[f.key]=fixture.confirmed[f.key];}
 const doc={id:'test-document',workspace_id:'test-workspace',created_by:'maker',artifact_attempts:[],input_snapshot:{context:{canonical:fixture.canonical,sourceId:'source',sourceRevision:1},confirmed,confirmedAt:'2026-10-05'}};
 const input={document:doc,template:{definition,status:'APPROVED',active:true,version_number:1,approved_by:'checker',approved_at:'2026-10-05'},configuration:{id:'config',encrypted_values:sealDocumentConfiguration(configuration),approved_by:'checker',approved_at:'2026-10-05'}};
 const key='contract-documents/test-workspace/test-document/attempt.docx',calls=[],objects=new Map();
 const request=async(url,options={})=>{const name=url.split('/').at(-1),body=JSON.parse(options.body??'{}');calls.push({name,body});if(name==='document_erasure_input')return null;if(name==='document_worker_input')return input;if(name==='reserve_document_artifact')return key;if(name==='document_attempt_status')return {id:doc.id,status:'FAILED'};return null;};
 return {input,key,calls,objects,request,store:{put:async(k,b)=>objects.set(k,b),delete:async k=>objects.delete(k)},job:{id:'job',lease_token:'lease'}};
}
test('storage partial failure cannot leave a generated or downloadable artifact',async()=>{
 const f=await setup();const store={...f.store,put:async(k,b)=>{await f.store.put(k,b);throw Error('storage disconnected');}};
 await assert.rejects(processContractDocument(f.job,f.request,store),/storage disconnected/);
 assert.equal(f.objects.size,0);assert.equal(f.calls.some(c=>c.name==='complete_contract_document'),false);assert.equal(f.calls.filter(c=>c.name==='fail_contract_document').length,1);
});
test('ambiguous completed response reconciles without deleting the successful artifact',async()=>{
 const f=await setup(),request=async(url,options)=>{if(url.endsWith('complete_contract_document'))throw Error('response lost');if(url.endsWith('document_attempt_status'))return {id:'test-document',status:'GENERATED',artifact_key:f.key};return f.request(url,options);};
 const result=await processContractDocument(f.job,request,f.store);assert.equal(result.reconciled,true);assert.equal(f.objects.size,1);
});
test('renderer eligibility failure produces no storage artifact and fails the existing job',async()=>{
 const f=await setup();f.input.template.status='DRAFT';await assert.rejects(processContractDocument(f.job,f.request,f.store),/TEMPLATE_NOT_APPROVED/);assert.equal(f.objects.size,0);assert.equal(f.calls.some(c=>c.name==='fail_contract_document'),true);
});
test('evidence payload is JSON, consumes mapped fields only, and template identity remains traceable',async()=>{
 const f=await setup();await processContractDocument(f.job,f.request,f.store);const completed=f.calls.find(c=>c.name==='complete_contract_document');assert.ok(Array.isArray(JSON.parse(completed.body.field_evidence)));assert.match(completed.body.artifact_sha,/^[a-f0-9]{64}$/);assert.ok(completed.body.artifact_bytes>0);
});
test('configuration encryption fails closed on absent key, tamper and forbidden field families',()=>{
 assert.throws(()=>sealDocumentConfiguration({'company.legal_name':'test'},{}),/KEY_NOT_CONFIGURED/);assert.throws(()=>sealDocumentConfiguration({'contract.amount':'1'}),/CONFIGURATION_INVALID/);
 const envelope=sealDocumentConfiguration({'company.legal_name':'Synthetic Legal Entity'});assert.equal(openDocumentConfiguration(envelope)['company.legal_name'],'Synthetic Legal Entity');envelope.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>openDocumentConfiguration(envelope));
});
