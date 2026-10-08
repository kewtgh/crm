import assert from 'node:assert/strict';
import test from 'node:test';
import {APP_ROLES} from '../lib/roles.ts';
import {assignableStaffRoles,canChangeStaffRole} from '../lib/staff-role-policy.ts';

test('staff role controls respect actor and target boundaries for every role pair',()=>{
 for(const actor of APP_ROLES)for(const target of APP_ROLES){
  assert.equal(canChangeStaffRole(actor,target),actor==='SUPER_ADMIN'||(actor==='ADMIN'&&!['ADMIN','SUPER_ADMIN'].includes(target)));
 }
 assert.deepEqual(assignableStaffRoles('SUPER_ADMIN'),[...APP_ROLES]);
 assert.deepEqual(assignableStaffRoles('ADMIN'),['SALES_DIRECTOR','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT']);
 for(const actor of APP_ROLES.filter(x=>!['ADMIN','SUPER_ADMIN'].includes(x)))assert.deepEqual(assignableStaffRoles(actor),[]);
});
