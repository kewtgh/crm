import {z} from "zod";
export const applicationStatuses=["DRAFT","PREPARING","SUBMITTED","UNDER_REVIEW","DECIDED","WITHDRAWN","CLOSED"] as const;
export const applicationDecisions=["ADMITTED","CONDITIONAL_ADMIT","WAITLISTED","REJECTED","DEFERRED","OTHER"] as const;
const timestamp=z.iso.datetime({offset:true}).nullable();
export const applicationDataSchema=z.object({enrollment_id:z.uuid(),target_organization_id:z.uuid().nullable(),external_application_id:z.string().trim().min(1).max(160).nullable(),deadline_on:z.iso.date().nullable(),status:z.enum(applicationStatuses),decision:z.enum(applicationDecisions).nullable(),submitted_at:timestamp,decision_at:timestamp,withdrawn_at:timestamp,owner_id:z.uuid().nullable()}).strict().superRefine((data,ctx)=>{
 const issue=(field:string)=>ctx.addIssue({code:"custom",path:[field],message:"APPLICATION_LIFECYCLE_INVALID"});
 if(["SUBMITTED","UNDER_REVIEW","DECIDED"].includes(data.status)&&!data.submitted_at)issue("submitted_at");
 if(data.status==="DECIDED"&&(!data.decision||!data.decision_at))issue("decision");
 if(data.decision&&!data.decision_at)issue("decision_at");
 if(data.decision_at&&data.submitted_at&&Date.parse(data.decision_at)<Date.parse(data.submitted_at))issue("decision_at");
 if(data.status==="WITHDRAWN"&&!data.withdrawn_at)issue("withdrawn_at");
 if(data.withdrawn_at&&data.submitted_at&&Date.parse(data.withdrawn_at)<Date.parse(data.submitted_at))issue("withdrawn_at");
});
export type ApplicationData=z.infer<typeof applicationDataSchema>;
export const applicationSaveSchema=z.object({id:z.uuid(),expectedRevision:z.number().int().positive().max(2147483647).nullable(),requestKey:z.string().min(8).max(160),statusReason:z.string().trim().max(1000).default(""),data:applicationDataSchema}).strict();
export const applicationFiltersSchema=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20),query:z.string().max(80).optional(),enrollmentId:z.uuid().optional(),studentId:z.uuid().optional(),productId:z.uuid().optional(),cohortId:z.uuid().optional(),ownerId:z.uuid().optional(),targetOrganizationId:z.uuid().optional(),status:z.enum(applicationStatuses).optional(),decision:z.enum(applicationDecisions).optional(),deadlineFrom:z.iso.date().optional(),deadlineTo:z.iso.date().optional()}).refine(data=>!data.deadlineFrom||!data.deadlineTo||data.deadlineFrom<=data.deadlineTo,{path:["deadlineTo"],message:"APPLICATION_INPUT_INVALID"});
