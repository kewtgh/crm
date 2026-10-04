import {z} from "zod";
export const milestoneTypes=["INTERVIEW","SUPPLEMENTARY_MATERIALS","PLACEMENT_TEST","I20_REQUESTED","I20_ISSUED","SEVIS_REQUIRED","SEVIS_COMPLETED","VISA_APPLICATION","VISA_APPOINTMENT","VISA_TRAINING","VISA_RESULT","FLIGHT_CONFIRMED","ORIENTATION","ARRIVAL","OTHER"] as const;
export const milestoneStatuses=["PENDING","SCHEDULED","IN_PROGRESS","COMPLETED","WAIVED","BLOCKED","CANCELLED"] as const;
export const interviewResults=["PASS","FAIL","RESCHEDULE","NO_SHOW","UNKNOWN"] as const;
export const visaResults=["APPROVED","REFUSED","ADMINISTRATIVE_PROCESSING","OTHER"] as const;
export const milestoneMetadataSchemas={
 INTERVIEW:z.object({summary:z.string().trim().min(1).max(2000).optional(),result:z.enum(interviewResults).optional(),interviewer:z.string().trim().min(1).max(160).optional()}).strict(),
 PLACEMENT_TEST:z.object({score:z.number().finite().min(-1e9).max(1e9).optional(),scale:z.string().trim().min(1).max(80).optional(),result:z.string().trim().min(1).max(160).optional()}).strict(),
 VISA_RESULT:z.object({result:z.enum(visaResults).optional(),reason:z.string().trim().min(1).max(1000).optional()}).strict(),
 OTHER:z.object({label:z.string().trim().min(1).max(160).optional()}).strict(),
};
const timestamp=z.iso.datetime({offset:true}).nullable(),optionalText=(max:number)=>z.string().trim().min(1).max(max).nullable();
export const milestoneDataSchema=z.object({enrollment_id:z.uuid(),application_id:z.uuid().nullable(),milestone_type:z.enum(milestoneTypes),status:z.enum(milestoneStatuses),due_at:timestamp,scheduled_at:timestamp,completed_at:timestamp,outcome:optionalText(160),owner_id:z.uuid().nullable(),external_reference:optionalText(160),note:z.string().trim().max(2000).nullable(),metadata:z.record(z.string(),z.unknown()),sequence:z.number().int().min(1).max(1000000)}).strict().superRefine((data,ctx)=>{
 if(data.status==="SCHEDULED"&&!data.scheduled_at)ctx.addIssue({code:"custom",path:["scheduled_at"],message:"MILESTONE_DATES_INVALID"});
 if(data.status==="COMPLETED"&&!data.completed_at)ctx.addIssue({code:"custom",path:["completed_at"],message:"MILESTONE_DATES_INVALID"});
 const schema=milestoneMetadataSchemas[data.milestone_type as keyof typeof milestoneMetadataSchemas]??z.object({}).strict(),parsed=schema.safeParse(data.metadata);
 if(!parsed.success)ctx.addIssue({code:"custom",path:["metadata"],message:"MILESTONE_METADATA_INVALID"});
}).transform(data=>({...data,metadata:(milestoneMetadataSchemas[data.milestone_type as keyof typeof milestoneMetadataSchemas]??z.object({}).strict()).parse(data.metadata) as Record<string,unknown>}));
export type MilestoneData=z.infer<typeof milestoneDataSchema>;
export const milestoneSaveSchema=z.object({id:z.uuid(),expectedRevision:z.number().int().positive().max(2147483647).nullable(),requestKey:z.string().min(8).max(160),statusReason:z.string().trim().max(1000).default(""),data:milestoneDataSchema}).strict();
export const milestoneFiltersSchema=z.object({enrollmentId:z.uuid(),applicationId:z.uuid().optional(),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20)});
