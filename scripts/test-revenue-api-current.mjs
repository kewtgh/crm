import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createServer} from 'node:http';

// Actual route, session store, capability checks, gateway and crm_app PostgreSQL role.
// Only Next's request-local cookies adapter is supplied by this bounded HTTP harness.
const input=JSON.parse(process.env.REVENUE_DISPOSABLE_API_FIXTURE||'null');
assert.ok(input?.service && input?.binding);
for(const key of ['DATABASE_URL','SYSTEM_DATABASE_URL']){
 const url=new URL(process.env[key]);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/revenue_test');
}
const scope=new AsyncLocalStorage();globalThis.__revenueTestRequestScope=scope;
registerHooks({resolve(specifier,context,next){
 if(specifier==='next/headers')return {url:'data:text/javascript,'+encodeURIComponent(`export async function cookies(){const r=globalThis.__revenueTestRequestScope.getStore();return {get(name){const value=(r.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='))?.slice(name.length+1);return value?{value}:undefined;}}} export async function headers(){return globalThis.__revenueTestRequestScope.getStore().headers;}`),shortCircuit:true};
 return next(specifier,context);
}});
const {createSession}=await import('../lib/auth/session-store.ts');
const {GET,POST}=await import('../app/api/revenue/route.ts');
const {databasePool}=await import('../lib/db/pools.ts');
const tokens={};let server;
try{
 for(const [name,userId] of Object.entries(input.users)){
  const row=(await databasePool('system').query('select password_version from app_auth.accounts where id=$1',[userId])).rows[0];
  tokens[name]=await createSession({userId,passwordVersion:row.password_version,role:'ADMIN',aal:name==='aal1'?'aal1':'aal2',persistent:false});
 }
 server=createServer(async(req,res)=>{
  try{let body='';for await(const chunk of req)body+=chunk;const request=new Request(`http://127.0.0.1:${server.address().port}${req.url}`,{method:req.method,headers:req.headers,...(body?{body}:{} )});
   const response=await scope.run(request,()=>req.method==='GET'?GET(request):POST(request));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());
  }catch{res.writeHead(500);res.end('Harness error');}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 process.env.APP_URL=base;
 async function request(actor,data,expected=200){
  const session=tokens[actor],headers={cookie:`crm_session=${session.token}; crm_csrf=${session.csrfToken}`,'x-csrf-token':session.csrfToken,origin:base,'content-type':'application/json'};
  const response=await fetch(`${base}/api/revenue${data||actor==='plain'?'':`?entity=${input.entity}`}`,{headers,...(data?{method:'POST',body:JSON.stringify(data)}:{})});const result=await response.json();
  assert.equal(response.status,expected,JSON.stringify(result));return result.accepted?result.item:result;
 }
 const payload={entity:input.entity,target:null,revision:null,requestKey:crypto.randomUUID(),operation:'evaluate',service:input.service,binding:input.binding,unit:'DELIVERABLE'};
 assert.equal((await request('aal1',payload,403)).code,'MFA_REQUIRED');
 const plain=await request('plain');assert.equal(plain.state,'NO_DESIGNATION');
 const evaluated=await request('maker',payload);assert.ok(evaluated.id);assert.equal((await request('maker',payload)).id,evaluated.id);
 const command=(actor,command,target,revision)=>request(actor,{entity:input.entity,target,revision,requestKey:crypto.randomUUID(),operation:'candidate',command,reference:'EX-INTEGRATED-REVIEW'});
 const submitted=await command('maker','SUBMIT',evaluated.id,evaluated.revision);
 const approved=await command('reviewer','APPROVE',submitted.id,submitted.revision);
 const before=await request('poster');assert.ok(!before.facts.some(f=>f.candidate_id===approved.id));
 const posting={entity:input.entity,target:approved.id,revision:approved.revision,requestKey:crypto.randomUUID(),operation:'post',reference:'EX-INTEGRATED-POST'};
 await request('reviewer',posting,400);
 const posted=await request('poster',posting);assert.ok(posted.id);assert.equal((await request('poster',posting)).id,posted.id);
 const after=await request('poster');const facts=after.facts.filter(f=>f.candidate_id===approved.id);assert.equal(facts.length,1);assert.equal(facts[0].amount,'842.60');
 console.log('PASS real HTTP Revenue route + real sessions + disposable PostgreSQL: evaluate / submit / independent approval / third-actor post / retry / AAL1 / no designation / separate fact');
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 for(const kind of ['app','system','worker'])await databasePool(kind).end();
 delete globalThis.__revenueTestRequestScope;
}
