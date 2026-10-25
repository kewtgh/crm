import type {ApprovalRecord,ApprovalPage} from "../../lib/approval-contract";
export const approvalId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const approvalRows:ApprovalRecord[]=Array.from({length:21},(_,n)=>({
 id:approvalId(n+1),requesterId:approvalId(n%2?98:99),requestNumber:`EX-REVIEW-${String(n+1).padStart(3,"0")}`,requestType:"PERFORMANCE_SUMMARY",type:"performanceSummary",object:`FICTIONAL_CONTEXT · ${approvalId(n+1)}`,requester:n%2?"Fictional Colleague":"Fictional Advisor",submitted:"2026-10-25T01:02:03.123456+00:00",expiresAt:"2099-01-01T00:00:00Z",level:n===1?"teamLead":"admin",reason:`Fictional approval request ${n+1}: review the stated scope and business purpose.`,status:"pending",executionStatus:"NOT_STARTED",decisionReason:null,decidedAt:null,reviewToken:(n+1).toString(16).padStart(64,"0"),canDecide:true,
}));
approvalRows.push(
 {...approvalRows[0],id:approvalId(22),requestNumber:"EX-EXPIRED",status:"expired",expiresAt:"2020-01-01T00:00:00Z",canDecide:false},
 {...approvalRows[0],id:approvalId(23),requestNumber:"EX-WITHDRAWN",status:"cancelled",canDecide:false},
 {...approvalRows[0],id:approvalId(24),requestNumber:"EX-EXECUTION-FAILED",status:"approved",executionStatus:"FAILED",decisionReason:"Fictional business context changed after review.",decidedAt:"2026-10-25T02:00:00Z",canDecide:false},
 {...approvalRows[0],id:approvalId(25),requestNumber:"EX-REVENUE-POLICY",requestType:"REVENUE_POLICY_VERSION",type:"revenuePolicyVersion",canDecide:false},
);
export const approvalInitial:ApprovalPage={items:approvalRows.filter(row=>row.status==="pending").slice(0,10),total:22,page:1,pageSize:10,asOf:"2026-10-25T02:30:00Z",summary:{pending:22,approved:1,rejected:0,cancelled:1,expired:1,failedExecution:1,highPrivilegePending:0}};
