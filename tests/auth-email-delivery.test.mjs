import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdir,rm} from "node:fs/promises";
import path from "node:path";

// Bundle actual routes, validation, role/MFA logic, trusted-device logic and email tokens.
// Substitute persistence, authenticated identities, captcha and external I/O only.
test("authentication emails retain their Web boundary while business communication stays queued", async context=>{
 const output=path.resolve("work/auth-email-contract/route-harness.cjs");
 await mkdir(path.dirname(output),{recursive:true});
 context.after(()=>rm(output,{force:true}));
 const stubs={
  "next/headers":`export const cookies=async()=>({get:name=>name==='crm_session'?{value:'fictional-session'}:undefined});`,
  "db/pools":`export const poolQuery=async(...args)=>globalThis.__emailContract.query(...args);export const withPoolClient=async(_boundary,fn)=>fn({query:(...args)=>globalThis.__emailContract.query('system',...args)});`,
  "db/gateway":`export class DatabaseRequestError extends Error{};export const databaseSystemJson=async()=>{throw new Error('UNEXPECTED_DATABASE_RPC')};export const databaseJson=databaseSystemJson;`,
  "auth/accounts":`export const authenticateAccount=async()=>globalThis.__emailContract.identity;export const appUserFromIdentity=identity=>({...identity,aal:'aal1'});export const recordLoginEvent=async value=>globalThis.__emailContract.events.push(value.outcome);export const findAccountByIdentifier=authenticateAccount;export const updateAccountPassword=async()=>{};`,
  "auth/session-store":`import {createHash,randomBytes} from 'node:crypto';export const sessionCookieName='crm_session',csrfCookieName='crm_csrf',persistentSessionMaxAge=2592000;export const hashOpaqueValue=value=>createHash('sha256').update(value).digest('hex');export const randomOpaqueToken=()=>randomBytes(32).toString('base64url');export const createSession=async()=>{globalThis.__emailContract.sessions++;return {id:'fictional-session',token:'fictional-token',csrfToken:'fictional-csrf',maxAge:600,persistent:false}};export const loadSession=async()=>({user:{...globalThis.__emailContract.identity,aal:'aal2'}});`,
  "captcha":`export const verifyCaptchaProof=async()=>({ok:true});`,
  "login-rate-limit":`export const loginThrottleIdentity=async()=>({});export const checkLoginRateLimit=async()=>({allowed:true});export const clearLoginFailures=async()=>{};export const recordLoginFailure=async()=>{};`,
  "account-recovery-rate-limit":`export const applyAccountRecoveryRateLimit=async()=>({allowed:true});`,
  "observability":`export const emitObservabilityEvent=async value=>globalThis.__emailContract.telemetry.push(value);export const requestOutcome=()=> 'success';export const routeTemplate=value=>value;`,
  "v220-repository":`export const queueCommunicationMessage=async()=>{globalThis.__emailContract.queued++;return {message:{id:'00000000-0000-4000-8000-000000000012',thread_id:'00000000-0000-4000-8000-000000000011',delivery_status:'QUEUED'}}};export const requeueCommunicationMessage=async()=>({id:'00000000-0000-4000-8000-000000000012',thread_id:'00000000-0000-4000-8000-000000000011'});export const createCommunicationThread=async()=>{};export const loadCommunications=async()=>{};export const loadCommunicationThread=async()=>{};export const recordInboundCommunication=async()=>{};`,
 };
 await build({stdin:{contents:`export {POST as login} from './app/api/auth/login/route';export {POST as passwordReset} from './app/api/auth/password-reset/route';export {issueEmailToken} from './lib/auth/email-tokens';export {GET as health} from './app/api/health/route';export {POST as communicate} from './app/api/communications/route';`,resolveDir:process.cwd(),loader:"ts"},outfile:output,bundle:true,platform:"node",format:"cjs",packages:"external",plugins:[{name:"test-boundaries",setup(builder){
  builder.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(key=>args.path===key||args.path.endsWith('/'+key));return key?{path:key,namespace:"test-boundary"}:undefined;});
  builder.onLoad({filter:/.*/,namespace:"test-boundary"},args=>({contents:stubs[args.path],loader:"js"}));
 }}]});
 const runtime=createRequire(import.meta.url)(output);
 const keys=["APP_URL","EMAIL_DELIVERY_WEBHOOK_URL","EMAIL_DELIVERY_WEBHOOK_TOKEN"];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const originalFetch=globalThis.fetch;
 context.after(()=>{globalThis.fetch=originalFetch;delete globalThis.__emailContract;for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}});
 process.env.APP_URL="https://crm.example.test";
 process.env.EMAIL_DELIVERY_WEBHOOK_URL="https://mailer.example.test/delivery";
 process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN="fictional-webhook-".padEnd(40,"x");
 const h=globalThis.__emailContract={identity:null,requests:[],queries:[],events:[],telemetry:[],sessions:0,queued:0,query:async(...args)=>{h.queries.push(args);return {rows:[]};}};
 globalThis.fetch=async(url,init)=>{h.requests.push({url,init,body:JSON.parse(init.body)});return new Response('{}',{status:200});};
 const identity=role=>({id:"00000000-0000-4000-8000-000000000001",email:"staff@example.test",role,status:"ACTIVE",passwordVersion:1,mfaEnabled:false,mustChangePassword:false});
 const request=(route,body)=>new Request("https://crm.example.test"+route,{method:"POST",headers:{"content-type":"application/json",origin:"https://crm.example.test","sec-fetch-site":"same-origin",cookie:"crm_session=fictional-session; crm_csrf=fictional-csrf-token-with-32-characters","x-csrf-token":"fictional-csrf-token-with-32-characters"},body:JSON.stringify(body)});
 const loginBody={identifier:"staff@example.test",password:"fictional-password",captchaProof:{provider:"turnstile",token:"fictional-proof"}};
 await context.test("SALES_SPECIALIST untrusted-device login sends exactly one six-digit 600-second code",async()=>{
  h.identity=identity("SALES_SPECIALIST");
  const response=await runtime.login(request('/api/auth/login',loginBody));
  assert.equal(response.status,200);assert.equal((await response.json()).next,"/verify-device");
  assert.equal(h.requests.length,1);assert.equal(h.sessions,0);
  const {body,init,url}=h.requests[0];assert.equal(url,process.env.EMAIL_DELIVERY_WEBHOOK_URL);assert.equal(init.headers.authorization,'Bearer '+process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN);
  assert.equal(body.to,h.identity.email);assert.equal(body.template,"device-verification");assert.match(body.payload.code,/^\d{6}$/);assert.equal(body.payload.expiresInSeconds,600);assert.equal(body.payload.url,undefined);
  assert.equal(init.headers['idempotency-key'],body.id);
  const insert=h.queries.find(([,sql])=>sql.includes('insert into app_auth.email_tokens'));assert.equal(insert[2][1],"DEVICE_VERIFICATION");assert.equal(insert[2][4],600);assert.notEqual(insert[2][2],body.payload.code);
  assert.ok(response.headers.get('set-cookie').includes('crm_pending_device_verification='));assert.ok(!response.headers.get('set-cookie').includes('crm_session='));
 });
 await context.test("ADMIN and SUPER_ADMIN keep mandatory MFA without substituting a device email",async()=>{
  for(const role of ["ADMIN","SUPER_ADMIN"]){for(const enabled of [false,true]){h.identity={...identity(role),mfaEnabled:enabled};const count=h.requests.length;const before=h.sessions;
   const response=await runtime.login(request('/api/auth/login',loginBody));assert.equal(response.status,200);assert.equal((await response.json()).next,enabled?"/mfa-challenge":"/mfa-setup");assert.equal(h.requests.length,count);assert.equal(h.sessions,before+1);assert.equal(h.events.at(-1),"MFA_REQUIRED");
  }}
 });
 await context.test("password recovery and email verification retain templates and expiry",async()=>{
  h.identity=identity("SALES_SPECIALIST");let before=h.requests.length;
  const response=await runtime.passwordReset(request('/api/auth/password-reset',{email:h.identity.email,captchaProof:loginBody.captchaProof}));assert.equal(response.status,200);assert.equal(h.requests.length,before+1);
  assert.equal(h.requests.at(-1).body.template,"password-reset");assert.equal(h.requests.at(-1).body.payload.expiresInSeconds,1800);assert.equal(new URL(h.requests.at(-1).body.payload.url).pathname,"/reset-password");
  before=h.requests.length;await runtime.issueEmailToken({userId:h.identity.id,email:h.identity.email,purpose:"EMAIL_VERIFICATION"});assert.equal(h.requests.length,before+1);assert.equal(h.requests.at(-1).body.template,"email-verification");assert.equal(h.requests.at(-1).body.payload.expiresInSeconds,86400);assert.equal(new URL(h.requests.at(-1).body.payload.url).pathname,"/api/auth/email-verification");
 });
 await context.test("communication send queues only; Web never fetches the provider",async()=>{
  h.identity=identity("ADMIN");const before=h.requests.length;
  const response=await runtime.communicate(request('/api/communications',{operation:"send",threadId:"00000000-0000-4000-8000-000000000011",body:"Fictional service update",idempotencyKey:"00000000-0000-4000-8000-000000000014"}));
  assert.equal(response.status,202);assert.equal((await response.json()).deliveryStatus,"QUEUED");assert.equal(h.queued,1);assert.equal(h.requests.length,before);
 });
 await context.test("readiness detects missing Web authentication delivery without external I/O or sensitive output",async()=>{
  const before=h.requests.length;delete process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN;
  const response=await runtime.health(new Request('http://127.0.0.1/api/health?mode=ready'));assert.equal(response.status,503);
  const body=await response.json();assert.equal(body.integrations.email.configured,false);assert.equal(body.integrations.email.configurationBoundary,"web-and-worker");assert.equal(body.integrations.email.externallyHealthy,null);assert.equal(h.requests.length,before);
  assert.ok(!JSON.stringify(body).includes(process.env.EMAIL_DELIVERY_WEBHOOK_URL));assert.ok(!JSON.stringify(body).includes('fictional-webhook-'));
 });
 for(const value of [process.env.EMAIL_DELIVERY_WEBHOOK_URL,'fictional-webhook-'.padEnd(40,'x')])assert.ok(!JSON.stringify(h.telemetry).includes(value));
});
