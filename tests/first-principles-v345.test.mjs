import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';
import {rpcArgumentValues} from '../lib/db/rpc-arguments.ts';
import {normalizeDateInput} from '../lib/date-input.ts';
import {globalRecordTypes,globalSearchQuerySchema,globalSearchResultSchema,globalRecordHref,interleaveGlobalResults,visibleGlobalRecordTypes} from '../lib/global-search-contract.ts';
import {searchGlobalRecords} from '../lib/global-search-repository.ts';
import {APP_ROLES} from '../lib/roles.ts';
import {globalDiscoveryZh,globalDiscoveryEn} from '../lib/i18n/locales/global-discovery.ts';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const record=(type,n,label='Fictional match')=>({id:id(n),type,labelZh:label,labelEn:label});

test('RPC JSON arrays are serialized without changing SQL arrays, scalar parameters or caller input',async()=>{
 const attendees=Object.freeze([{email:'attendee@example.test',consentConfirmed:true}]),reminders=Object.freeze([30,1440]),entries=[['attendees',attendees],['reminders',reminders],['label','Fictional']];
 const client={query:async(sql,values)=>{assert.ok(sql.includes('pg_proc'));assert.deepEqual(values,['fictional_rpc']);return{rows:[{input_names:['attendees','reminders','label'],required_count:2,json_arguments:['attendees']}]};}};
 const values=await rpcArgumentValues(client,'fictional_rpc',entries);
 assert.equal(values[0],JSON.stringify(attendees));assert.equal(values[1],reminders);assert.equal(values[2],'Fictional');assert.equal(entries[0][1],attendees);
 assert.deepEqual(await rpcArgumentValues({query:()=>assert.fail('scalar calls need no metadata query')},'fictional_rpc',[['title','Fictional'],['payload',{items:[]}]]),['Fictional',{items:[]}]);
});

test('RPC metadata respects supplied names, defaults and ambiguous overloads',async()=>{
 const array=[],entries=[['items',array]];
 const json={input_names:['items','optional_label'],required_count:1,json_arguments:['items']};
 assert.deepEqual(await rpcArgumentValues({query:async()=>({rows:[json]})},'fictional',entries),['[]']);
 for(const rows of [[],[{...json,required_count:2}],[json,{...json,json_arguments:[]}],[{...json,input_names:['other']}]])assert.equal((await rpcArgumentValues({query:async()=>({rows})},'fictional',entries))[0],array);
});

test('compact calendar entry normalizes exact values and rejects impossible dates instead of rolling them',()=>{
 for(const [value,expected] of [['2215','22:15'],['0803','08:03'],['00:00','00:00'],['2359','23:59']])assert.equal(normalizeDateInput(value,'time'),expected);
 for(const value of ['2400','2460','1261','8','083','ab03','23:59:60'])assert.equal(normalizeDateInput(value,'time'),null,value);
 assert.equal(normalizeDateInput('1005','date',2026),'2026-10-05');assert.equal(normalizeDateInput('0803','date',2026),'2026-08-03');
 assert.equal(normalizeDateInput('0229','date',2024),'2024-02-29');assert.equal(normalizeDateInput('0229','date',2026),null);
 for(const value of ['0230','0001','1301','2026-04-31','1900-02-29','2026-2-05'])assert.equal(normalizeDateInput(value,'date',2026),null,value);
 assert.equal(normalizeDateInput('2000-02-29','date'),'2000-02-29');assert.equal(normalizeDateInput('2026-10-05T2215','datetime-local'),'2026-10-05T22:15');
 assert.equal(normalizeDateInput('2026-10','month'),'2026-10');assert.equal(normalizeDateInput('2026-13','month'),null);assert.equal(normalizeDateInput('','date'),'');
});

test('global discovery rejects unbounded, unknown and prototype-shaped scope input',()=>{
 assert.deepEqual(globalSearchQuerySchema.parse({q:' Fictional ',type:'CONTACT'}),{q:'Fictional',type:'CONTACT'});
 for(const patch of [{q:'a'},{q:'x'.repeat(81)},{q:'%%'},{type:'USER'},{type:'constructor'},{type:'__proto__'},{extra:true}])assert.equal(globalSearchQuerySchema.safeParse({q:'Fictional',...patch}).success,false);
 for(const type of globalRecordTypes){const href=globalRecordHref({type,id:id(1)});assert.ok(href.startsWith('/')&&!href.startsWith('//'));assert.ok(href.includes(id(1)));}
 assert.throws(()=>globalRecordHref({type:'CONTACT',id:'javascript:example'}));
 assert.equal(globalSearchResultSchema.safeParse({query:'Fictional',scope:'all',items:[{...record('CONTACT',1),href:'https://example.test'}],sources:[],truncated:false}).success,false);
});

test('fair suggestions preserve each available record type rather than starving later sources',()=>{
 const groups=globalRecordTypes.map((type,index)=>Array.from({length:8},(_,n)=>record(type,index*10+n+1,n===7?'Fictional':'Other Fictional match')));
 const result=interleaveGlobalResults(groups,'Fictional');assert.equal(result.items.length,16);assert.equal(result.truncated,true);
 assert.equal(new Set(result.items.slice(0,10).map(item=>item.type)).size,10);assert.ok(result.items.slice(0,10).every(item=>item.labelZh==='Fictional'));
 assert.deepEqual(interleaveGlobalResults([[record('TASK',1),record('TASK',1)]],'Fictional').items,[record('TASK',1)]);
});

function searchAdapter(failed=[],calls=[]){return async(url,init)=>{
 calls.push({url,init});const name=new URL(url,'https://example.test').pathname.split('/').at(-1);
 const types={organizations:'ORGANIZATION',contacts:'CONTACT',opportunities:'OPPORTUNITY',crm_tasks:'TASK',contracts:'CONTRACT',quotes:'QUOTE',products:'PRODUCT',list_students_page:'STUDENT',households:'HOUSEHOLD',leads:'LEAD'},type=types[name];
 assert.ok(type,'No user-directory or unknown source may be queried');if(failed.includes(type))throw new Error('FICTIONAL_PRIVATE_DIAGNOSTIC');
 return [{id:id(globalRecordTypes.indexOf(type)+1),name_zh:'示例记录',name_en:'Fictional',title_zh:'示例记录',title_en:'Fictional',short_name:'',contract_number:'EX-CONTRACT',quote_number:'EX-QUOTE',code:'EX-PRODUCT',current_grade:'Example'}];
};}

test('federated search preserves healthy RLS-backed sources and reports only fixed failure metadata',async()=>{
 const calls=[],result=await searchGlobalRecords({q:'Fictional'},'ADMIN',searchAdapter(['CONTACT'],calls));
 assert.equal(globalSearchResultSchema.safeParse(result).success,true);assert.ok(result.items.length>0);
 assert.deepEqual(result.sources.find(source=>source.type==='CONTACT'),{type:'CONTACT',status:'FAILED',returned:0});
 assert.ok(result.items.some(item=>item.type==='TASK'));assert.ok(!JSON.stringify(result).includes('FICTIONAL_PRIVATE_DIAGNOSTIC'));
 assert.ok(calls.every(call=>!call.url.includes('list_assignable_crm_users')));
 const failed=await searchGlobalRecords({q:'Fictional'},'ADMIN',searchAdapter([...globalRecordTypes]));assert.equal(failed.items.length,0);assert.ok(failed.sources.every(source=>source.status==='FAILED'));
 assert.deepEqual((await searchGlobalRecords({q:'Fictional',type:'pages'},'ADMIN',()=>assert.fail('page search must not query data'))).sources,[]);
});

test('record focus limits actual queries and cannot expand server capabilities',async()=>{
 const calls=[],result=await searchGlobalRecords({q:'Fictional',type:'TASK'},'ADMIN',searchAdapter([],calls));assert.equal(calls.length,1);assert.equal(result.items[0].type,'TASK');
 const role=APP_ROLES.find(role=>!visibleGlobalRecordTypes(role).includes('QUOTE'));assert.ok(role);
 await assert.rejects(searchGlobalRecords({q:'Fictional',type:'QUOTE'},role,()=>assert.fail('forbidden source queried')),/GLOBAL_SEARCH_SCOPE_FORBIDDEN/);
 const visible=await searchGlobalRecords({q:'Fictional'},role,searchAdapter());assert.ok(visible.sources.every(source=>visibleGlobalRecordTypes(role).includes(source.type)));
 const corrupt=await searchGlobalRecords({q:'Fictional',type:'TASK'},'ADMIN',async()=>[{id:'bad',title_zh:'示例',title_en:'Fictional'}]);assert.equal(corrupt.sources[0].status,'FAILED');
});

test('new search and scheduling messages retain complete bilingual coverage',()=>{
 assert.deepEqual(Object.keys(globalDiscoveryEn).sort(),Object.keys(globalDiscoveryZh).sort());
 for(const key of ['discovery.partial','discovery.failed','discovery.limited','calendarCreate.consent','input.compactDateHint'])assert.ok(globalDiscoveryEn[key]);
});

test('actual global and target API handlers validate scope before queries and preserve focus identity',async context=>{
 const output=path.resolve('work/v345-contract/routes.cjs');await mkdir(path.dirname(output),{recursive:true});
 const stubs={
  auth:`export const getCurrentUser=async()=>globalThis.__discoveryTest.user;`,
  observability:`export const emitObservabilityEvent=async()=>{};export const requestOutcome=()=> 'success';export const routeTemplate=value=>value;`,
  'global-search-repository':`export const searchGlobalRecords=async(...args)=>{globalThis.__discoveryTest.calls.push({kind:'search',args});return {query:args[0].q,scope:args[0].type,items:[],sources:[],truncated:false};};`,
  'contract-repository':`export const listContracts=async value=>{globalThis.__discoveryTest.calls.push({kind:'contracts',value});return {items:[],total:0};};export const createContractDraft=async()=>{};export const createContractRenewal=async()=>{};`,
  'phase2-repository':`export const loadFinanceOverview=async value=>{globalThis.__discoveryTest.calls.push({kind:'finance',value});return {quotes:[]};};export const financeOperation=async()=>{};`,
  'governance-repository':`export const executeSuperAdminApproval=async()=>{};`,
  'db/gateway':`export class DatabaseRequestError extends Error {};export const databaseJson=async()=>{};export const databaseSystemJson=databaseJson;export const databaseRequest=databaseJson;`,
 };
 await build({stdin:{contents:`export {GET as search} from './app/api/search/global/route';export {GET as contracts} from './app/api/contracts/route';export {GET as finance} from './app/api/finance/route';`,resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'discovery-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(key=>args.path===key||args.path.endsWith('/'+key));return key?{path:key,namespace:'discovery-stub'}:undefined;});builder.onLoad({filter:/.*/,namespace:'discovery-stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 const runtime=createRequire(import.meta.url)(output),h=globalThis.__discoveryTest={user:{id:id(99),role:'ADMIN',aal:'aal2'},calls:[]};context.after(async()=>{delete globalThis.__discoveryTest;await rm(output,{force:true});});
 for(const query of ['q=a','q=Fictional&type=constructor','q=Fictional&type=USER','q=Fictional&q=Other','q=Fictional&unknown=1'])assert.equal((await runtime.search(new Request('http://localhost:3200/api/search/global?'+query))).status,400);
 assert.equal(h.calls.length,0);
 const response=await runtime.search(new Request('http://localhost:3200/api/search/global?q=Fictional&type=TASK'));assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const role=APP_ROLES.find(role=>!visibleGlobalRecordTypes(role).includes('QUOTE'));h.user.role=role;const before=h.calls.length;assert.equal((await runtime.search(new Request('http://localhost:3200/api/search/global?q=Fictional&type=QUOTE'))).status,403);assert.equal(h.calls.length,before);
 h.user.role='ADMIN';assert.equal((await runtime.contracts(new Request('http://localhost:3200/api/contracts?focus='+id(30)))).status,200);assert.equal(h.calls.at(-1).value.id,id(30));
 assert.equal((await runtime.finance(new Request('http://localhost:3200/api/finance?quoteId='+id(31)))).status,200);assert.equal(h.calls.at(-1).value.quoteId,id(31));
 for(const [handler,url] of [[runtime.contracts,'contracts?focus=invalid'],[runtime.finance,'finance?quoteId=invalid']])assert.equal((await handler(new Request('http://localhost:3200/api/'+url))).status,400);
 h.user=null;assert.equal((await runtime.search(new Request('http://localhost:3200/api/search/global?q=Fictional'))).status,401);
});

test('target pages use authorized ID reads and product focus is read-only',async()=>{
 const products=await readFile(new URL('../components/products-page.tsx',import.meta.url),'utf8'),contracts=await readFile(new URL('../components/contracts-page.tsx',import.meta.url),'utf8');
 assert.match(products,/\[editProduct,setEditProduct\]=useState<ProductRecord\|null>\(null\)/);assert.match(products,/\[detailProduct,setDetailProduct\]=useState<ProductRecord\|null>\(initialProducts.find/);
 assert.match(contracts,/&focus=\$\{encodeURIComponent\(initialFocus\)\}/);
 for(const file of ['products','contracts','finance'])assert.match(await readFile(new URL(`../app/(crm)/${file}/page.tsx`,import.meta.url),'utf8'),/FocusedRecordNotice/);
});
