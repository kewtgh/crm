import {z} from "zod";

export const communicationPurposes=["SERVICE","TRANSACTIONAL","EVENT","MARKETING"] as const;
export const communicationDefaults={q:"",status:"all",purpose:"all",delivery:"all",page:1,pageSize:20,thread:""} as const;
export const communicationViewSchema=z.object({
 q:z.string().max(160).default(""),status:z.enum(["all","OPEN","CLOSED"]).default("all"),
 purpose:z.enum(["all",...communicationPurposes]).default("all"),
 delivery:z.enum(["all","pending","failed","uncertain"]).default("all"),
 page:z.coerce.number().int().min(1).max(100000).default(1),
 pageSize:z.coerce.number().int().refine(value=>[10,20,50].includes(value)).default(20),
 thread:z.union([z.literal(""),z.uuid()]).default(""),
}).strict();
export type CommunicationView=z.infer<typeof communicationViewSchema>;
export function readCommunicationView(params:URLSearchParams):CommunicationView {
 return Object.fromEntries(Object.entries(communicationDefaults).map(([key,fallback])=>{
  const parsed=communicationViewSchema.shape[key as keyof CommunicationView].safeParse(params.get(key)??fallback);
  return [key,parsed.success?parsed.data:fallback];
 })) as CommunicationView;
}
export function writeCommunicationView(params:URLSearchParams,view:CommunicationView){
 const next=new URLSearchParams(params);
 for(const [key,fallback] of Object.entries(communicationDefaults)){
  const value=view[key as keyof CommunicationView];if(value===fallback)next.delete(key);else next.set(key,String(value));
 }
 return next;
}
export const communicationInboxQuerySchema=communicationViewSchema.omit({thread:true});
const requestKey=z.string().trim().min(8).max(160);
export const communicationCommandSchema=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("thread"),contactId:z.uuid(),subject:z.string().trim().min(2).max(200),channel:z.literal("EMAIL"),purpose:z.enum(communicationPurposes),requestKey}).strict(),
 z.object({operation:z.literal("send"),threadId:z.uuid(),body:z.string().trim().min(1).max(10000),idempotencyKey:requestKey}).strict(),
 z.object({operation:z.literal("inbound"),threadId:z.uuid(),body:z.string().trim().min(1).max(10000),idempotencyKey:requestKey}).strict(),
 z.object({operation:z.literal("retry"),messageId:z.uuid(),expectedUpdatedAt:z.iso.datetime({offset:true}),requestKey}).strict(),
]);
export type CommunicationCommand=z.infer<typeof communicationCommandSchema>;
const deliveryStatus=z.enum(["QUEUED","PROCESSING","SENT","FAILED","UNCERTAIN","RECEIVED","DELIVERED"]);
export const communicationResultSchema=z.object({
 operation:z.enum(["thread","send","inbound","retry"]),threadId:z.uuid(),messageId:z.uuid().optional(),
 deliveryStatus:deliveryStatus.optional(),accepted:z.boolean().optional(),
}).superRefine((value,context)=>{
 if(value.operation!=="thread"&&(!value.messageId||!value.deliveryStatus||value.accepted!==true))context.addIssue({code:"custom",message:"INVALID_COMMUNICATION_RESULT"});
});
export type CommunicationResult=z.infer<typeof communicationResultSchema>;
const summary=z.object({id:z.uuid(),contactId:z.uuid(),contactZh:z.string(),contactEn:z.string(),email:z.string(),subject:z.string(),channel:z.string(),purpose:z.enum(communicationPurposes),status:z.enum(["OPEN","CLOSED"]),lastMessageAt:z.string().nullable()});
export const communicationInboxSchema=z.object({items:z.array(summary),total:z.number().int().nonnegative(),page:z.number().int().positive(),pageSize:z.number().int().positive().max(50)});
export const communicationThreadSchema=summary.extend({
 messages:z.array(z.object({id:z.uuid(),direction:z.enum(["INBOUND","OUTBOUND"]),body:z.string(),deliveryStatus,failureCode:z.string(),retryAllowed:z.boolean(),retryToken:z.iso.datetime({offset:true}),attemptCount:z.number().int().nonnegative(),providerAttemptCount:z.number().int().nonnegative(),createdAt:z.string()})),
 messageTotal:z.number().int().nonnegative(),messagePage:z.number().int().positive(),messagePageSize:z.number().int().positive().max(50),
});
