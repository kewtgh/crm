import assert from 'node:assert/strict';
import test from 'node:test';
import {workflowEntries,visibleWorkflowEntries,actionSignalSummary} from '../lib/workflow-navigation.ts';
import {APP_ROLES} from '../lib/roles.ts';
import {hasCapability} from '../lib/capabilities.ts';
import {zhWorkflowUsability,enWorkflowUsability} from '../lib/i18n/locales/workflow-usability.ts';
import {enrollmentSaveSchema} from '../lib/enrollment-input.ts';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('workflow launchpad only exposes permitted existing destinations for each staff role',()=>{
 assert.ok(workflowEntries.some(x=>x.audience==='daily'));assert.ok(workflowEntries.some(x=>x.audience==='management'));
 assert.equal(new Set(workflowEntries.map(x=>x.href)).size,workflowEntries.length);
 for(const role of APP_ROLES){const entries=visibleWorkflowEntries(role);assert.deepEqual(entries,workflowEntries.filter(x=>hasCapability(role,x.capability)));for(const x of entries){assert.match(x.href,/^\/[a-z/-]+$/);assert.ok(zhWorkflowUsability[`flow.launch.${x.key}`]);assert.ok(enWorkflowUsability[`flow.launch.${x.key}Help`]);}}
});
test('category signal counts preserve overlap and do not claim unique underlying tasks',()=>{
 const sameFactInTwoCategories=[{count:1,priority:'urgent'},{count:1,priority:'high'}];assert.deepEqual(actionSignalSummary(sameFactInTwoCategories),{total:2,urgent:1});assert.deepEqual(actionSignalSummary([]),{total:0,urgent:0});assert.match(enWorkflowUsability['flow.overlapHelp'],/not a count of distinct tasks/);
});
test('new workflow help and safeguards have matched bilingual keys',()=>{assert.deepEqual(Object.keys(zhWorkflowUsability).sort(),Object.keys(enWorkflowUsability).sort());for(const value of Object.values(enWorkflowUsability))assert.ok(value.trim());});
test('contextual enrollment remains canonical explicit input, not completion or guardian inference',()=>{
 const input={id:uuid(3),requestKey:'contextual-enrollment',expectedRevision:null,statusReason:'',data:{student_id:uuid(1),cohort_id:uuid(2),household_id:null,opportunity_id:null,status:'LEAD',owner_id:uuid(4),sales_owner_id:null,enrolled_at:null,completed_at:null,withdrawn_at:null,withdrawal_reason:''}};
 assert.equal(enrollmentSaveSchema.parse(input).data.status,'LEAD');assert.equal(enrollmentSaveSchema.safeParse({...input,data:{...input.data,cohort_id:''}}).success,false);assert.equal(enrollmentSaveSchema.safeParse({...input,data:{...input.data,legal_authority:true}}).success,false);
});
import {loadDashboard} from '../lib/dashboard-repository.ts';
import {readFile} from 'node:fs/promises';
test('optional growth failure preserves core work and is explicitly unavailable; core failure still fails',async()=>{
 const raw={todayTasks:2,overdueTasks:1,pendingApprovals:0,renewalsDue:0,riskContracts:0,activeProducts:1,unreadNotifications:0,focusTasks:[],monthRevenueByCurrency:{CNY:100}};
 const partial=await loadDashboard({json:async()=>raw,growth:async()=>{throw new Error('fixture-unavailable');}});
 assert.equal(partial.todayTasks,2);assert.equal(partial.growthUnavailable,true);assert.deepEqual(partial.monthRevenueByCurrency,{CNY:100});
 const good=await loadDashboard({json:async()=>raw,growth:async()=>({summary:{activeCampaigns:1,attributedLeads:3,pendingAdmissions:4}})});assert.equal(good.growthUnavailable,false);assert.equal(good.pendingAdmissions,4);
 await assert.rejects(loadDashboard({json:async()=>{throw new Error('core-unavailable');},growth:async()=>({summary:{}})}),/core-unavailable/);
});
test('campaign presentation cannot derive Revenue or ROI from opportunity amounts and planned budget',async()=>{const source=await readFile(new URL('../components/growth-workspace.tsx',import.meta.url),'utf8');assert.doesNotMatch(source,/won\s*-\s*item\.budget|roi\.toFixed|t\("growth\.roi"\)/);assert.match(source,/flow\.campaignBasisHelp/);assert.match(enWorkflowUsability['growth.won'],/opportunity/);});
