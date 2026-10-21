import assert from 'node:assert/strict';
import test from 'node:test';
import {APP_ROLES} from '../lib/roles.ts';
import {visibleDestinations,activeDestination} from '../lib/navigation-destinations.ts';
import {canReviewApproval} from '../lib/approval-review-policy.ts';

test('each non-administrator has only personal approval and recycle destinations in Administration',()=>{
 for(const role of APP_ROLES.filter(role=>!['ADMIN','SUPER_ADMIN'].includes(role))){
  const visible=visibleDestinations(role);
  assert.deepEqual(visible.filter(d=>d.space==='admin').map(d=>d.href).sort(),['/approvals','/recycle-bin']);
  assert.ok(!visible.some(d=>d.href.startsWith('/admin')));
  assert.equal(activeDestination('/admin/users',new URLSearchParams(),visible),undefined);
  assert.equal(activeDestination('/approvals',new URLSearchParams(),visible)?.id,'approvals');
 }
 for(const role of ['ADMIN','SUPER_ADMIN']){
  const visible=visibleDestinations(role);
  assert.ok(visible.some(d=>d.href==='/admin/users'));
  assert.ok(!visible.some(d=>d.id==='personal-recycle'));
 }
});

test('personal review actions enforce non-administrator independence without changing administrator workflows',()=>{
 for(const role of APP_ROLES){
  const actor={id:'fictional-self',role};
  const administrator=['ADMIN','SUPER_ADMIN'].includes(role);
  assert.equal(canReviewApproval(actor,{requesterId:actor.id,level:'teamLead'}),administrator);
  assert.equal(canReviewApproval(actor,{requesterId:'fictional-other',level:'admin'}),administrator);
  assert.equal(canReviewApproval(actor,{requesterId:'fictional-other',level:'teamLead'}),administrator||['SALES_DIRECTOR','SALES_MANAGER'].includes(role));
 }
});
