import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {build} from 'esbuild';
import {accountSaveSchema,mfaReadSchema,notificationSettingsSchema,preferencePreview,quietHoursSchema,requireConfirmedPreferences,sessionRevocationSchema,settingsReadSchema,trustedDevicesSchema} from '../lib/settings-contract.ts';
import {personalSettings,personalDevice,personalId as id} from './fixtures/personal-settings-data.ts';
import {personalSettingsEn,personalSettingsZh} from '../lib/i18n/locales/personal-settings.ts';

test('quiet hours preserve arbitrary intervals, normalize compact minutes, and reject empty/equal/partial windows',()=>{
 const result=notificationSettingsSchema.parse({section:'notifications',notifications:personalSettings.notifications,quietHoursStart:'2215',quietHoursEnd:'0803'});
 assert.equal(result.quietHoursStart,'22:15:00');assert.equal(result.quietHoursEnd,'08:03:00');
 assert.equal(quietHoursSchema.parse({quietHoursStart:'23:15:30',quietHoursEnd:'07:45'}).quietHoursStart,'23:15:30');
 assert.ok(quietHoursSchema.safeParse({quietHoursStart:null,quietHoursEnd:null}).success);
 for(const [start,end] of [['',null],[null,'08:00'],['24:00','08:00'],['0803','08:03:00'],['10:00','10:00'],['23:15:00.1','08:03']])assert.equal(quietHoursSchema.safeParse({quietHoursStart:start,quietHoursEnd:end}).success,false);
 const off=structuredClone(personalSettings.notifications);off.security={email:false,inApp:false};assert.equal(notificationSettingsSchema.safeParse({...result,notifications:off}).success,false);
});

test('read contracts distinguish unavailable, malformed and empty security facts',()=>{
 assert.throws(()=>requireConfirmedPreferences(false),error=>error.code==='USER_PREFERENCES_UNAVAILABLE'&&error.status===400);assert.doesNotThrow(()=>requireConfirmedPreferences(true));
 assert.ok(settingsReadSchema.safeParse({settings:personalSettings,email:'reviewer@example.test'}).success);
 for(const value of [{},{settings:{}},{settings:{...personalSettings,timezone:'Unknown/Zone'},email:'reviewer@example.test'}])assert.equal(settingsReadSchema.safeParse(value).success,false);
 assert.deepEqual(trustedDevicesSchema.parse({devices:[]}),{devices:[]});assert.equal(trustedDevicesSchema.safeParse({}).success,false);
 assert.equal(trustedDevicesSchema.safeParse({devices:[{...personalDevice,lastUsedAt:'invalid'}]}).success,false);
 const valid=mfaReadSchema.parse({factors:[{id:id(3),status:'verified',secret:'discarded-fictional-value'}],recoveryCodesRemaining:null});assert.equal(valid.recoveryCodesRemaining,null);assert.equal(valid.factors[0].secret,undefined);
 for(const value of [{factors:[]},{factors:null,recoveryCodesRemaining:0},{factors:[],recoveryCodesRemaining:-1}])assert.equal(mfaReadSchema.safeParse(value).success,false);
});

test('revocation and account outcomes cannot collapse partial or unconfirmed results into success',()=>{
 for(const [sessionsRevoked,trustedDevicesRevoked] of [[true,true],[true,false],[false,true],[false,false]]){
  const ok=sessionsRevoked&&trustedDevicesRevoked;assert.ok(sessionRevocationSchema.safeParse({ok,sessionsRevoked,trustedDevicesRevoked}).success);assert.equal(sessionRevocationSchema.safeParse({ok:!ok,sessionsRevoked,trustedDevicesRevoked}).success,false);
 }
 assert.equal(sessionRevocationSchema.safeParse({ok:true}).success,false);
 for(const emailVerification of ['NOT_REQUESTED','SENT','UNCONFIRMED'])assert.ok(accountSaveSchema.safeParse({ok:true,preferencesSaved:true,emailVerification}).success);
 assert.equal(accountSaveSchema.safeParse({ok:true,preferencesSaved:false,emailVerification:'SENT'}).success,false);
});

test('preference previews follow actual timezone date boundaries and DST',()=>{
 const instant=new Date('2026-10-25T23:30:00Z');
 assert.equal(preferencePreview('Asia/Taipei','yyyy-MM-dd',instant),'2026-10-26 07:30');
 assert.equal(preferencePreview('America/New_York','MM/dd/yyyy',instant),'10/25/2026 19:30');
 assert.equal(preferencePreview('Europe/London','dd/MM/yyyy',new Date('2026-03-29T01:30:00Z')),'29/03/2026 02:30');
});

test('personal settings messages retain bilingual coverage and placeholders',()=>{
 assert.deepEqual(Object.keys(personalSettingsEn).sort(),Object.keys(personalSettingsZh).sort());
 for(const key of Object.keys(personalSettingsZh))assert.deepEqual(personalSettingsEn[key].match(/\{\w+\}/g)?.sort()??[],personalSettingsZh[key].match(/\{\w+\}/g)?.sort()??[],key);
});

test('actual settings/session/MFA APIs preserve validation, authentication and independent outcomes',async context=>{
 const output=path.resolve('work/v346-contract/routes.cjs');await mkdir(path.dirname(output),{recursive:true});
 const stubs={
  auth:`export const getCurrentUser=async()=>globalThis.__personalTest.user;export const requireUser=getCurrentUser;export const shouldChallengeMfa=()=>false;export const authCookieNames={session:'session'};export const isMfaRequiredRole=()=>true;`,
  'components/app-shell':`export const AppShell=()=>null;`,
  'workspace-metrics':`export const emptyRelationshipHealth={hasData:false,score:0,sampleSize:0};export const loadWorkspaceRelationshipHealth=async()=>emptyRelationshipHealth;`,
  'page-metadata':`export const getRequestLocale=async()=> 'en';`,
  'next/headers':`export const cookies=async()=>({get:name=>({value:name==='session'?'fictional-session':'fictional-trusted-cookie'})});`,
  observability:`export const emitObservabilityEvent=async()=>{};export const requestOutcome=()=> 'success';export const routeTemplate=value=>value;`,
  'request-security':`export const mutationIsTrusted=()=>globalThis.__personalTest.trusted;`,
  'settings-repository':`const call=(name,args)=>globalThis.__personalTest.calls.push({name,args});export const loadUserSettings=async()=>{if(globalThis.__personalTest.settingsFailure)throw Error('fictional-read-failure');return globalThis.__personalTest.settings;};export const updateAccount=async(...args)=>{call('account',args);if(globalThis.__personalTest.preferenceFailure)throw Error('fictional-write-failure');};export const updateProfile=async(...args)=>call('profile',args);export const updateLocale=async(...args)=>call('locale',args);export const updateNotifications=async(...args)=>call('notifications',args);`,
  'auth/email-tokens':`export const issueEmailToken=async(...args)=>{globalThis.__personalTest.calls.push({name:'email',args});if(globalThis.__personalTest.emailFailure)throw Error('private-provider-detail');return 'fictional-token';};`,
  'auth/session-store':`export const elevateSession=async()=>{};export const revokeOtherSessions=async(...args)=>{globalThis.__personalTest.calls.push({name:'sessions',args});if(globalThis.__personalTest.sessionsFailure)throw Error('private-session-detail');return 0;};`,
  'trusted-devices':`export const securityCookieNames={trustedDevice:'trusted'};export const revokeUserTrustedDevices=async()=>{};export const revokeOtherTrustedDevices=async(...args)=>{globalThis.__personalTest.calls.push({name:'devices',args});if(globalThis.__personalTest.devicesFailure)throw Error('private-device-detail');return 0;};`,
  'auth/totp':`export const listTotpFactors=async()=>[{id:'${id(3)}',status:'verified'}];export const deleteTotpFactor=async()=>{};export const enrollTotp=async()=>{};export const verifyTotp=async()=>{};`,
  'mfa-recovery':`export const consumeMfaRecoveryCode=async()=>{};export const replaceMfaRecoveryCodes=async()=>{};export const countMfaRecoveryCodes=async()=>{if(globalThis.__personalTest.countFailure)throw Error('private-count-detail');return 8;};`,
  'db/gateway':`export class DatabaseRequestError extends Error {};export const getSessionToken=async()=> 'fictional-session';`,
 };
 await build({stdin:{contents:`export {default as layout} from './app/(crm)/layout';export {GET as settings,PATCH as patch} from './app/api/settings/route';export {DELETE as revoke} from './app/api/settings/sessions/route';export {GET as mfa} from './app/api/settings/mfa/route';`,resolveDir:process.cwd(),loader:'ts'},outfile:output,bundle:true,platform:'node',format:'cjs',packages:'external',plugins:[{name:'personal-boundaries',setup(builder){builder.onResolve({filter:/.*/},args=>{const key=Object.keys(stubs).find(key=>args.path===key||args.path.endsWith('/'+key));return key?{path:key,namespace:'personal-stub'}:undefined;});builder.onLoad({filter:/.*/,namespace:'personal-stub'},args=>({contents:stubs[args.path],loader:'js'}));}}]});
 const runtime=createRequire(import.meta.url)(output),h=globalThis.__personalTest={user:{id:id(99),email:'reviewer@example.test',role:'ADMIN',aal:'aal2'},settings:personalSettings,calls:[],trusted:true};context.after(async()=>{delete globalThis.__personalTest;await rm(output,{force:true});});
 h.settingsFailure=true;const fallback=await runtime.layout({children:'Fictional security content'});assert.equal(fallback.props.preferencesUnavailable,true);assert.equal(fallback.props.children,'Fictional security content');assert.equal(fallback.props.preferredLocale,'en');h.settingsFailure=false;assert.equal((await runtime.layout({children:'Fictional content'})).props.preferencesUnavailable,false);
 h.settings={...personalSettings,dateFormat:'unrecognized'};assert.equal((await runtime.layout({children:'Fictional content'})).props.preferencesUnavailable,true);h.settings=personalSettings;
 const req=(route,body,method='PATCH')=>new Request('http://localhost:3200/api/settings'+route,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const account={section:'account',email:'new-reviewer@example.test',locale:'en',timezone:'Europe/London',dateFormat:'dd/MM/yyyy'};
 h.emailFailure=true;const partial=await runtime.patch(req('',account));assert.equal(partial.status,200);assert.deepEqual(await partial.json(),{ok:true,preferencesSaved:true,emailVerification:'UNCONFIRMED'});assert.deepEqual(h.calls.map(c=>c.name),['account','email']);
 h.calls=[];h.preferenceFailure=true;assert.equal((await runtime.patch(req('',account))).status,500);assert.deepEqual(h.calls.map(c=>c.name),['account']);h.preferenceFailure=false;
 h.calls=[];h.emailFailure=false;assert.equal((await(await runtime.patch(req('',{...account,email:h.user.email}))).json()).emailVerification,'NOT_REQUESTED');assert.equal(h.calls.filter(c=>c.name==='email').length,0);
 assert.equal((await(await runtime.patch(req('',account))).json()).emailVerification,'SENT');
 h.calls=[];const payload={section:'notifications',notifications:personalSettings.notifications,quietHoursStart:'2215',quietHoursEnd:'0803'};
 assert.equal((await runtime.patch(req('',payload))).status,200);assert.equal(h.calls[0].args[2],'22:15:00');assert.equal(h.calls[0].args[3],'08:03:00');
 h.calls=[];assert.equal((await runtime.patch(req('',{...payload,quietHoursEnd:'22:15'}))).status,400);assert.equal(h.calls.length,0);
 for(const [sessionsFailure,devicesFailure] of [[false,false],[true,false],[false,true],[true,true]]){h.sessionsFailure=sessionsFailure;h.devicesFailure=devicesFailure;h.calls=[];const response=await runtime.revoke(req('/sessions',undefined,'DELETE')),body=await response.json();assert.equal(body.ok,!sessionsFailure&&!devicesFailure);assert.equal(body.sessionsRevoked,!sessionsFailure);assert.equal(body.trustedDevicesRevoked,!devicesFailure);assert.equal(JSON.stringify(body).includes('private-'),false);assert.equal(h.calls.find(c=>c.name==='sessions').args[0],h.user.id);assert.equal(h.calls.find(c=>c.name==='sessions').args[1],'fictional-session');assert.deepEqual(h.calls.find(c=>c.name==='devices').args,['fictional-session','fictional-trusted-cookie']);}
 h.countFailure=true;const mfa=await runtime.mfa(new Request('http://localhost:3200/api/settings/mfa'));assert.equal(mfa.headers.get('cache-control'),'private, no-store');const mfaBody=await mfa.json();assert.equal(mfaBody.factors.length,1);assert.equal(mfaBody.recoveryCodesRemaining,null);
 h.trusted=false;h.calls=[];assert.equal((await runtime.patch(req('',account))).status,403);assert.equal((await runtime.revoke(req('/sessions',undefined,'DELETE'))).status,403);assert.equal(h.calls.length,0);
 h.trusted=true;h.user=null;assert.equal((await runtime.settings(new Request('http://localhost:3200/api/settings'))).status,401);assert.equal((await runtime.revoke(req('/sessions',undefined,'DELETE'))).status,401);
});
