import {z} from "zod";

export const approvalDatabaseTypes={contractSign:"CONTRACT_SIGN",contractExport:"CONTRACT_EXPORT",performanceSummary:"PERFORMANCE_SUMMARY",performanceAllocation:"PERFORMANCE_ALLOCATION",quoteDiscount:"QUOTE_DISCOUNT",refund:"REFUND",marketingContactExport:"MARKETING_CONTACT_EXPORT",crmExport:"CRM_EXPORT",revenueReportingProfile:"REVENUE_REPORTING_PROFILE",revenuePolicyVersion:"REVENUE_POLICY_VERSION",revenueServiceBinding:"REVENUE_SERVICE_BINDING",revenueAuthorityAssignment:"REVENUE_AUTHORITY_ASSIGNMENT",revenueRecognitionCandidate:"REVENUE_RECOGNITION_CANDIDATE"} as const;
export const approvalTypes=["contractSign","contractExport","performanceSummary","performanceAllocation","quoteDiscount","refund","marketingContactExport","crmExport","revenueReportingProfile","revenuePolicyVersion","revenueServiceBinding","revenueAuthorityAssignment","revenueRecognitionCandidate","other"] as const;
export const approvalStatuses=["pending","approved","rejected","cancelled","expired"] as const;
export const approvalDefaults={q:"",type:"all",status:"pending",scope:"all",execution:"all",page:1,pageSize:10} as const;
export const approvalQuerySchema=z.object({
 q:z.string().max(100).default(""),type:z.enum(["all",...approvalTypes]).default("all"),status:z.enum(["all",...approvalStatuses]).default("pending"),
 scope:z.enum(["all","mine","reviewable"]).default("all"),execution:z.enum(["all","NOT_STARTED","SUCCEEDED","FAILED"]).default("all"),
 page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().refine(value=>[10,20,50].includes(value)).default(10),
}).strict();
export type ApprovalQuery=z.infer<typeof approvalQuerySchema>;
export function readApprovalQuery(params:URLSearchParams):ApprovalQuery {
 return Object.fromEntries(Object.entries(approvalDefaults).map(([key,fallback])=>{
  const parsed=approvalQuerySchema.shape[key as keyof ApprovalQuery].safeParse(params.get(key)??fallback);return [key,parsed.success?parsed.data:fallback];
 })) as ApprovalQuery;
}
export function writeApprovalQuery(params:URLSearchParams,query:ApprovalQuery){
 const next=new URLSearchParams(params);for(const [key,fallback] of Object.entries(approvalDefaults)){const value=query[key as keyof ApprovalQuery];if(value===fallback)next.delete(key);else next.set(key,String(value));}return next;
}
export function approvalTypeKey(requestType:string):typeof approvalTypes[number]{
 return (Object.entries(approvalDatabaseTypes).find(([,value])=>value===requestType)?.[0]??"other") as typeof approvalTypes[number];
}
const stamp=z.iso.datetime({offset:true}),token=z.string().regex(/^[a-f0-9]{64}$/);
export const approvalRecordSchema=z.object({
 id:z.uuid(),requesterId:z.uuid(),requestNumber:z.string(),requestType:z.string().regex(/^[A-Z_]{1,80}$/),
 type:z.enum(approvalTypes),object:z.string(),requester:z.string(),submitted:stamp,expiresAt:stamp,
 level:z.enum(["teamLead","admin","superAdmin"]),reason:z.string(),status:z.enum(approvalStatuses),
 executionStatus:z.enum(["NOT_STARTED","SUCCEEDED","FAILED"]),decisionReason:z.string().nullable(),decidedAt:stamp.nullable(),
 reviewToken:token,canDecide:z.boolean(),
});
export type ApprovalRecord=z.infer<typeof approvalRecordSchema>;
export const approvalSummarySchema=z.object({pending:z.number().int().nonnegative(),approved:z.number().int().nonnegative(),rejected:z.number().int().nonnegative(),cancelled:z.number().int().nonnegative(),expired:z.number().int().nonnegative(),failedExecution:z.number().int().nonnegative(),highPrivilegePending:z.number().int().nonnegative()});
export type ApprovalSummary=z.infer<typeof approvalSummarySchema>;
export const approvalPageSchema=z.object({items:z.array(approvalRecordSchema),total:z.number().int().nonnegative(),page:z.number().int().positive(),pageSize:z.number().int().positive().max(50),summary:approvalSummarySchema,asOf:stamp});
export type ApprovalPage=z.infer<typeof approvalPageSchema>;
export const approvalDecisionSchema=z.object({decision:z.enum(["APPROVED","REJECTED"]),comment:z.string().trim().max(1000).default(""),expectedReviewToken:token,requestKey:z.string().min(8).max(120).refine(value=>value===value.trim())}).strict().refine(value=>value.decision!=="REJECTED"||Boolean(value.comment),{path:["comment"],message:"REJECTION_REASON_REQUIRED"});
export type ApprovalDecision=z.infer<typeof approvalDecisionSchema>;
export const approvalDecisionResultSchema=z.object({id:z.uuid(),status:z.enum(["approved","rejected"]),executionStatus:z.enum(["NOT_STARTED","SUCCEEDED","FAILED"]),accepted:z.literal(true)}).strict();
export type ApprovalDecisionResult=z.infer<typeof approvalDecisionResultSchema>;
export function approvalDisplayStatus(item:Pick<ApprovalRecord,"status"|"expiresAt">,now=Date.now()){
 return item.status==="pending"&&Date.parse(item.expiresAt)<=now?"expired":item.status;
}
export function approvalIsActionable(item:Pick<ApprovalRecord,"status"|"expiresAt"|"canDecide">,now=Date.now()){
 const deadline=Date.parse(item.expiresAt);
 return item.canDecide&&item.status==="pending"&&Number.isFinite(deadline)&&deadline>now;
}
