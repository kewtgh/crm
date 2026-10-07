import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ApiClientError} from '../lib/api-client.ts';
import {isDefinitiveMutationFailure,settleMutation} from '../lib/mutation-outcome.ts';
import {parseDirectoryFilters,writeDirectoryFilters,organizationFilterDefaults,contactFilterDefaults,assertPagedResult} from '../lib/directory-filter-query.ts';
import {reliabilityEn,reliabilityZh} from '../lib/i18n/locales/reliability.ts';

test('transport loss, timeout, server failure and unknown exceptions cannot release receipt identity',()=>{
 for(const error of [new ApiClientError('NETWORK_ERROR',0),new ApiClientError('REQUEST_TIMEOUT',0),new ApiClientError('TIMEOUT',408),new ApiClientError('FAILED',500),new ApiClientError('INVALID_API_RESPONSE',502),new Error('Synthetic transport failure'),null])assert.equal(isDefinitiveMutationFailure(error),false);
 for(const status of [400,401,403,404,409,422,429])assert.equal(isDefinitiveMutationFailure(new ApiClientError('REJECTED',status)),true);
});
test('accepted mutation with failed refresh remains saved, with no implicit retry',async()=>{
 let writes=0,reads=0;const failed=new Error('Synthetic refresh failure');
 const result=await settleMutation(async()=>{writes++;},async()=>{reads++;throw failed;});
 assert.deepEqual(result,{state:'saved-refresh-failed',error:failed});assert.equal(writes,1);assert.equal(reads,1);
});
test('write failure never invokes refresh; refresh errors retain their independent outcome',async()=>{
 for(const error of [new ApiClientError('FORBIDDEN',403),new ApiClientError('NETWORK_ERROR',0)]){
  let reads=0;assert.deepEqual(await settleMutation(async()=>{throw error;},async()=>{reads++;}),{state:'failed',error});assert.equal(reads,0);
 }
 assert.deepEqual(await settleMutation(async()=>({saved:true}),async()=>({items:[]})),{state:'saved'});
});
test('directory URL round-trip retains supported advanced values and unrelated context',()=>{
 const filters={...organizationFilterDefaults,city:'Example city',curriculum:'IB',organizationType:'SCHOOL',commercialTier:'A',ownerId:'00000000-0000-4000-8000-000000000099'};
 const params=writeDirectoryFilters(new URLSearchParams('focus=example&page=2&tab=overview'),filters);
 assert.deepEqual(parseDirectoryFilters(params,organizationFilterDefaults),filters);assert.equal(params.get('focus'),'example');assert.equal(params.get('page'),'2');
 assert.equal(parseDirectoryFilters(new URLSearchParams('admin=true&city=Example'),organizationFilterDefaults).admin,undefined);
 assert.equal(Object.hasOwn(parseDirectoryFilters(params,contactFilterDefaults),'city'),false);
 const cleared=writeDirectoryFilters(params,organizationFilterDefaults);assert.equal(cleared.has('city'),false);assert.equal(cleared.get('tab'),'overview');
});
test('required collection shape rejects malformed data instead of rendering zero',()=>{
 for(const input of [null,{}, {items:[]},{items:[],total:null},{items:{},total:0},{items:[],total:-1},{items:[],total:1.5},{items:[],total:'0'}])assert.throws(()=>assertPagedResult(input));
 assert.throws(()=>assertPagedResult({items:[],total:0,metrics:{}}));
 assert.doesNotThrow(()=>assertPagedResult({items:[],total:0,metrics:{total:0,needsAttention:0,averageCompleteness:0}}));
});
test('current workspace and reliability regression contracts are wired to both CI test entrypoints',()=>{
 const {scripts}=JSON.parse(fs.readFileSync('package.json','utf8'));
 for(const entry of ['test:raw','test:contracts:raw'])for(const file of ['workspace-redesign','interaction-reliability'])assert.ok(scripts[entry].includes(`tests/${file}.test.mjs`),`${entry}: ${file}`);
});
test('new recovery and no-match labels have bilingual parity',()=>{
 assert.deepEqual(Object.keys(reliabilityEn),Object.keys(reliabilityZh));for(const key of Object.keys(reliabilityEn)){assert.ok(reliabilityEn[key]);assert.ok(reliabilityZh[key]);}
});
