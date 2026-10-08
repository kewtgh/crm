import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ApiClientError} from '../lib/api-client.ts';
import {classifyReadFailure} from '../lib/read-failure.ts';
import {createReceiptAttempt} from '../lib/receipt-attempt.ts';
import {normalizeDatabaseErrorCode} from '../lib/db/gateway.ts';
import {managementFixture} from './fixtures/management-overview.ts';
import {projectManagementOverview} from '../lib/management-overview-projection.ts';
import {validateOverview} from '../lib/management-ux-presentation.ts';

test('an explicitly empty channel result produces zero counts without hiding malformed nonempty data',()=>{
 const raw=managementFixture();raw.channel.total=0;raw.channel.snapshot.visibleAccounts=0;raw.channel.items=[];raw.channel.snapshotTotals={};raw.channel.totals={};
 const result=validateOverview(projectManagementOverview(raw));
 for(const key of ['visibleAccounts','availablePublicLeads','channelOpenOpportunities','primaryContributions','assistContributions','eventsHeld'])assert.equal(result.modules.channel.metrics.find(metric=>metric.key===key).value,0);
 raw.channel.total=1;raw.channel.snapshot.visibleAccounts=1;
 assert.throws(()=>validateOverview(projectManagementOverview(raw)));
});

test('report failures classify recovery without exposing messages or arbitrary references',()=>{
 const cases=[[401,'AUTH_REQUIRED','session'],[403,'PERMISSION_DENIED','permission'],[400,'MANAGEMENT_INPUT_INVALID','scope'],[400,'DATABASE_MIGRATION_REQUIRED','migration'],[504,'DATABASE_TIMEOUT','timeout'],[0,'NETWORK_ERROR','network'],[502,'INVALID_API_RESPONSE','response'],[500,'MANAGEMENT_LOAD_FAILED','unavailable']];
 for(const [status,code,kind] of cases){assert.deepEqual(classifyReadFailure(new ApiClientError(code,status,'safe-reference-123')),{kind,requestId:'safe-reference-123'});}
 assert.equal(classifyReadFailure(new ApiClientError('PRIVATE_DATA',500,'unsafe reference with spaces')).requestId,undefined);
 assert.deepEqual(classifyReadFailure(new Error('Untrusted data')),{kind:'response'});
});

test('receipt retry freezes the entire intention and new accepted intentions receive new keys',()=>{
 let count=0;const attempt=createReceiptAttempt(()=>`request-${++count}`);
 const payload={nameEn:'Fictional learner',householdId:null};const first=attempt.prepare(payload);
 payload.nameEn='Changed input';assert.equal(attempt.prepare(payload),first);
 assert.equal(JSON.parse(first).nameEn,'Fictional learner');assert.equal(count,1);
 attempt.clear();const second=attempt.prepare(payload);assert.notEqual(second,first);assert.equal(count,2);
});

test('database domain codes preserve symbolic casing, never raw exception text',()=>{
 assert.equal(normalizeDatabaseErrorCode('P0001','PAYLOAD_REUSE'),'PAYLOAD_REUSE');
 assert.equal(normalizeDatabaseErrorCode('P0001','permission_denied'),'PERMISSION_DENIED');
 assert.equal(normalizeDatabaseErrorCode('P0001','Private value: not a code'),'P0001');
 assert.equal(normalizeDatabaseErrorCode('42P01','relation detail'),'DATABASE_MIGRATION_REQUIRED');
});

test('workflow saved state disables repeat writes and preserves refresh-only recovery',async()=>{
 const source=await readFile(new URL('../components/workflow-template-editor.tsx',import.meta.url),'utf8');
 assert.match(source,/if\(accepted\).*refreshAccepted/);
 assert.match(source,/setAccepted\(true\)/);
 assert.match(source,/disabled=\{pending\|\|uncertain\|\|accepted\}/);
 assert.match(source,/steps:\[newWorkflowStep\(\)\]/);
});
