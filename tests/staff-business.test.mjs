import assert from 'node:assert/strict';
import test from 'node:test';
import {APP_ROLES,roleMessageKey} from '../lib/roles.ts';
import {hasCapability} from '../lib/capabilities.ts';
import {assignableStaffRoles,canChangeStaffRole} from '../lib/staff-role-policy.ts';
import {BUSINESS_FUNCTIONS,businessFunctionLabels} from '../lib/staff-business.ts';
import {workflowStepSchema} from '../lib/workflow-input.ts';
import {en} from '../lib/i18n/locales/en.ts';
import {zhCN} from '../lib/i18n/locales/zh-CN.ts';

test('non-sales profiles grant bounded capabilities without administrator, Revenue or sales reporting authority',()=>{
 const roles=APP_ROLES.filter(role=>!role.startsWith('SALES_')&&!['ADMIN','SUPER_ADMIN'].includes(role));
 assert.equal(roles.length,6);
 for(const role of roles){
  for(const cap of ['admin.access','users.manage','performance.view','performance.manage','revenue.policy.approve','revenue.recognition.post','finance.cashApplication.manage'])assert.equal(hasCapability(role,cap),false,`${role}:${cap}`);
  assert.ok(assignableStaffRoles('ADMIN').includes(role));assert.ok(canChangeStaffRole('ADMIN',role));
 }
 assert.equal(hasCapability('FINANCE_MANAGER','finance.payment.record'),true);
 assert.equal(hasCapability('FINANCE_SPECIALIST','finance.payment.record'),false);
 assert.equal(hasCapability('OPERATIONS_MANAGER','finance.view'),false);
 assert.equal(hasCapability('ACADEMIC_SPECIALIST','education.manage'),true);
 assert.equal(hasCapability('CUSTOMER_SUCCESS_SPECIALIST','education.manage'),false);
 assert.equal(canChangeStaffRole('ADMIN','ADMIN'),false);
});
test('business functions and all template owner roles have bilingual labels without granting task authority',()=>{
 assert.equal(BUSINESS_FUNCTIONS.length,8);
 for(const value of BUSINESS_FUNCTIONS)assert.ok(businessFunctionLabels[value].every(label=>label.length));
 for(const role of APP_ROLES){
  assert.ok(en[roleMessageKey[role]]);assert.ok(zhCN[roleMessageKey[role]]);
  assert.ok(workflowStepSchema.safeParse({id:'00000000-0000-4000-8000-000000000001',sequence:1,name_zh:'示例步骤',name_en:'Fictional step',required:true,default_owner_role:role,offset_basis:null,offset_days:null,step_kind:'TASK',task_config:{title_zh:'示例任务',title_en:'Fictional task',description:'',priority:'NORMAL'},milestone_config:null,checkpoint_config:null}).success);
 }
});
