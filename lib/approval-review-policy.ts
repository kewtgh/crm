import type {AppRole} from './roles';
import {approvalIsActionable,type ApprovalRecord} from './approval-contract';

// RLS supplies only the actor's own requests or assigned reviews. The decision
// RPC remains authoritative for assignment, MFA and current request state.
export function canReviewApproval(actor:{id:string;role:AppRole},request:Pick<ApprovalRecord,'requesterId'|'level'|'canDecide'|'status'|'expiresAt'>,now=Date.now()){
 if(!approvalIsActionable(request,now))return false;
 if(actor.role==='ADMIN'||actor.role==='SUPER_ADMIN')return true;
 return request.requesterId!==actor.id&&request.level==='teamLead'&&['SALES_DIRECTOR','SALES_MANAGER'].includes(actor.role);
}
