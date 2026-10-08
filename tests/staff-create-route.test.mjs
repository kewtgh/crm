import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {mkdir,rm} from "node:fs/promises";
import path from "node:path";

test("staff creation route retains queued acceptance and sanitizes expected/unexpected failures",async context=>{
 const output=path.resolve("work/staff-create-v3353/route-harness.cjs");await mkdir(path.dirname(output),{recursive:true});context.after(()=>rm(output,{force:true}));
 const stubs={
  "admin-users-repository":`export const createStaffUser=async(input,actor)=>globalThis.__staffCreateRoute.create(input,actor);export const listStaffUsers=async()=>({items:[]});`,
  "db/gateway":`export class DatabaseRequestError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code;}}`,
  "api":`export const apiRoute=handler=>handler;export const apiRequestId=()=> 'fictional-request';export const requireApiRole=async()=>({id:'fictional-admin',role:'SUPER_ADMIN',aal:'aal2'});export const requireApiAal2=async()=>{};export const parsePagination=()=>({page:1,pageSize:20});`,
  "observability":`export const emitObservabilityEvent=async event=>globalThis.__staffCreateRoute.events.push(event);`,
 };
 await build({stdin:{contents:`export {POST} from './app/api/admin/users/route';export {DatabaseRequestError} from './lib/db/gateway';`,resolveDir:process.cwd(),loader:"ts"},outfile:output,bundle:true,platform:"node",format:"cjs",packages:"external",plugins:[{name:"test-boundaries",setup(builder){builder.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(k=>args.path.endsWith('/'+k));return key?{path:key,namespace:"stub"}:undefined;});builder.onLoad({filter:/.*/,namespace:"stub"},args=>({contents:stubs[args.path],loader:"js"}));}}]});
 const runtime=createRequire(import.meta.url)(output),originalFetch=globalThis.fetch,originalOrigin=process.env.APP_URL;
 context.after(()=>{globalThis.fetch=originalFetch;delete globalThis.__staffCreateRoute;if(originalOrigin===undefined)delete process.env.APP_URL;else process.env.APP_URL=originalOrigin;});
 process.env.APP_URL="https://crm.example.test";
 let providerRequests=0;globalThis.fetch=async()=>{providerRequests++;throw new Error("UNEXPECTED_PROVIDER_REQUEST");};
 const h=globalThis.__staffCreateRoute={events:[],create:async()=>({item:{id:"fictional-created",role:"SALES_SPECIALIST",invitationDeliveryStatus:"QUEUED"},emailDeliveryStatus:"UNCONFIRMED"})};
 const request=()=>new Request("https://crm.example.test/api/admin/users",{method:"POST",headers:{"content-type":"application/json",origin:"https://crm.example.test","sec-fetch-site":"same-origin",cookie:"crm_session=fictional-session; crm_csrf=fictional-csrf-token-with-32-characters","x-csrf-token":"fictional-csrf-token-with-32-characters"},body:JSON.stringify({username:"fictional.staff",displayNameZh:"示例员工",displayNameEn:"Fictional Staff",email:"staff@example.test",role:"SALES_SPECIALIST",teamId:"00000000-0000-4000-8000-000000000010"})});
 const accepted=await runtime.POST(request());assert.equal(accepted.status,202);assert.equal((await accepted.json()).emailDeliveryStatus,"UNCONFIRMED");assert.equal(providerRequests,0);
 const privateText="synthetic SQL detail with fictional-private-token";
 for(const [error,status,body,observed] of [
  [new runtime.DatabaseRequestError(400,"TEAM_NOT_FOUND",privateText),400,{code:"TEAM_NOT_FOUND",field:"teamId"},"TEAM_NOT_FOUND"],
  [new runtime.DatabaseRequestError(409,"STAFF_IDENTITY_TAKEN",privateText),409,{code:"STAFF_IDENTITY_TAKEN"},"STAFF_IDENTITY_TAKEN"],
  [new runtime.DatabaseRequestError(403,"ROLE_ASSIGNMENT_FORBIDDEN",privateText),403,{code:"ROLE_ASSIGNMENT_FORBIDDEN"},"ROLE_ASSIGNMENT_FORBIDDEN"],
  [Object.assign(new Error(privateText),{code:"42501",detail:privateText}),500,{code:"STAFF_USERS_FAILED"},"DATABASE_POLICY_DENIED"],
  [new Error(privateText),500,{code:"STAFF_USERS_FAILED"},"STAFF_USERS_FAILED"],
 ]){
  h.create=async()=>{throw error;};const response=await runtime.POST(request());assert.equal(response.status,status);assert.deepEqual(await response.json(),body);assert.equal(h.events.at(-1).errorCode,observed);assert.ok(!JSON.stringify(h.events).includes(privateText));
 }
 assert.equal(providerRequests,0);
});
