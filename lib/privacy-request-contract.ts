import {z} from "zod";
export const privacyTypes=["ACCESS","EXPORT","CORRECTION","RESTRICTION","DELETION"] as const;
export const privacyStatuses=["RECEIVED","IDENTITY_REVIEW","IN_PROGRESS","WAITING_APPROVAL","EXECUTING","EXECUTION_FAILED","FULFILLED","REJECTED","CANCELLED"] as const;
export const privacyViewSchema=z.object({status:z.enum(["all",...privacyStatuses]).default("all"),type:z.enum(["all",...privacyTypes]).default("all"),scope:z.enum(["all","mine"]).default("all"),due:z.enum(["all","overdue"]).default("all"),page:z.coerce.number().int().min(1).max(100000).default(1),pageSize:z.coerce.number().pipe(z.union([z.literal(10),z.literal(20),z.literal(50)])).default(20)}).strict();
export type PrivacyView=z.infer<typeof privacyViewSchema>;
export function readPrivacyView(value:Record<string,unknown>){const parsed=privacyViewSchema.safeParse(value);return parsed.success?parsed.data:privacyViewSchema.parse({});}
export const privacyViewSearch=(value:PrivacyView)=>new URLSearchParams(Object.entries(value).map(([key,value])=>[key,String(value)])).toString();
export const privacyChangesSchema=z.object({nameZh:z.string().trim().min(1).max(160).optional(),nameEn:z.string().trim().min(1).max(160).optional(),email:z.union([z.email().max(320),z.literal("")]).optional(),phone:z.string().trim().max(80).optional(),title:z.string().trim().max(160).optional()}).strict();
const create=z.object({operation:z.literal("create"),type:z.enum(privacyTypes),note:z.string().trim().min(10).max(2000),contactId:z.uuid(),changes:privacyChangesSchema.default({}),requestKey:z.uuid()}).refine(value=>(value.type==="CORRECTION")===(Object.keys(value.changes).length>0),{message:"PRIVACY_CORRECTION_REQUIRED",path:["changes"]});
const manage=z.object({operation:z.literal("manage"),id:z.uuid(),reviewToken:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(["IDENTITY_REVIEW","IN_PROGRESS","WAITING_APPROVAL","FULFILLED","REJECTED","CANCELLED"]),identityStatus:z.enum(["PENDING","VERIFIED","FAILED"]),decision:z.string().trim().min(3).max(2000),requestKey:z.uuid()});
export const privacyCommandSchema=z.discriminatedUnion("operation",[create.strict(),manage.strict()]);
export type PrivacyCommand=z.infer<typeof privacyCommandSchema>;
const date=z.iso.datetime({offset:true});
export const privacyRecordSchema=z.object({id:z.uuid(),contactId:z.uuid().nullable(),createdBy:z.uuid(),type:z.enum(privacyTypes),status:z.enum(privacyStatuses),identityStatus:z.enum(["PENDING","VERIFIED","FAILED"]),note:z.string(),decisionNote:z.string(),dueAt:date,createdAt:date,assignedTo:z.string(),requestedChanges:z.object({nameZh:z.string().optional(),nameEn:z.string().optional(),email:z.string().optional(),phone:z.string().optional(),title:z.string().optional()}),reviewToken:z.string().regex(/^[a-f0-9]{64}$/),executionStatus:z.enum(["","QUEUED","PROCESSING","COMPLETED","FAILED"]),executionFailed:z.boolean(),artifactExpiresAt:date.nullable(),receiptSha256:z.string()});
export type PrivacyRequestRecord=z.infer<typeof privacyRecordSchema>;
export const privacyPageSchema=z.object({items:z.array(privacyRecordSchema),total:z.number().int().nonnegative(),page:z.number().int().positive(),pageSize:z.number().int().positive()});
export type PrivacyPage=z.infer<typeof privacyPageSchema>;
export const privacyReceiptSchema=z.object({id:z.uuid(),status:z.enum(privacyStatuses),identityStatus:z.enum(["PENDING","VERIFIED","FAILED"]),accepted:z.literal(true)});
export type PrivacyReceipt=z.infer<typeof privacyReceiptSchema>;
export function privacyNextStatuses(item:Pick<PrivacyRequestRecord,"status"|"type">):Array<Extract<PrivacyCommand,{operation:"manage"}>["status"]>{
 switch(item.status){case "RECEIVED":return["IDENTITY_REVIEW","CANCELLED"];case "IDENTITY_REVIEW":return["IN_PROGRESS","REJECTED","CANCELLED"];case "IN_PROGRESS":return[item.type==="EXPORT"||item.type==="DELETION"?"WAITING_APPROVAL":"FULFILLED","REJECTED","CANCELLED"];case "WAITING_APPROVAL":return["FULFILLED","REJECTED"];case "EXECUTION_FAILED":return["IN_PROGRESS","REJECTED","CANCELLED"];default:return[];}
}
