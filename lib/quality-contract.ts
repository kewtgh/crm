import {z} from "zod";

export const qualityStatusFilters=["active","OPEN","ASSIGNED","RESOLVED","DISMISSED","all"] as const;
export const qualitySeverities=["all","HIGH","MEDIUM","LOW"] as const;
export const qualityAssignments=["all","mine","unassigned"] as const;
export const qualityFilterSchema=z.object({q:z.string().max(100).default(""),status:z.enum(qualityStatusFilters).default("active"),severity:z.enum(qualitySeverities).default("all"),assignment:z.enum(qualityAssignments).default("all")});
export type QualityFilters=z.infer<typeof qualityFilterSchema>;
export const qualityDefaults:QualityFilters={q:"",status:"active",severity:"all",assignment:"all"};
export function qualityParams(params:Pick<URLSearchParams,"get">){return Object.fromEntries(Object.keys(qualityDefaults).map(key=>[key,params.get(key)??qualityDefaults[key as keyof QualityFilters]]));}
export function readQualityFilters(params:Pick<URLSearchParams,"get">):QualityFilters{const values=qualityParams(params);return Object.fromEntries(Object.entries(qualityDefaults).map(([key,value])=>{const parsed=qualityFilterSchema.shape[key as keyof QualityFilters].safeParse(values[key]);return [key,parsed.success?parsed.data:value];})) as QualityFilters;}
export function writeQualityFilters(params:URLSearchParams,filters:QualityFilters){const next=new URLSearchParams(params);for(const key of Object.keys(qualityDefaults) as Array<keyof QualityFilters>){if(filters[key]===qualityDefaults[key])next.delete(key);else next.set(key,filters[key]);}return next;}
export function qualityIsActive(status:string){return status==="OPEN"||status==="ASSIGNED";}
const revision=z.number().int().positive(),key=z.string().trim().min(8).max(160);
export const qualityCommandSchema=z.discriminatedUnion("operation",[
 z.object({operation:z.literal("run"),requestKey:key}),
 z.object({operation:z.literal("resolve"),requestKey:key,id:z.uuid(),expectedRevision:revision,resolution:z.string().trim().min(2).max(500),dismiss:z.boolean()}),
 z.object({operation:z.literal("assign"),requestKey:key,id:z.uuid(),expectedRevision:revision}),
 z.object({operation:z.literal("configure"),requestKey:key,ruleKey:z.string().trim().min(2).max(100),expectedRevision:revision,enabled:z.boolean(),severity:z.enum(["HIGH","MEDIUM","LOW"])}),
]);
export type QualityCommand=z.infer<typeof qualityCommandSchema>;
const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export function qualityRecordHref(item:{entityType:string;entityId:string;details:Record<string,string>}){
 const {entityType:kind,entityId:id,details}=item;if(!uuid.test(id))return null;
 const direct:Record<string,string>={ORGANIZATION:`/schools/${id}`,CONTACT:`/people/${id}`,TASK:`/tasks/${id}`,STUDENT_SUCCESS_CASE:`/student-success?focus=${id}`,ENROLLMENT:`/enrollments?focus=${id}`,APPLICATION:`/applications?focus=${id}`,COHORT:`/products?cohort=${id}`,STUDENT:`/students?focus=${id}`,LEAD:`/leads?focus=${id}`,OPPORTUNITY:"/opportunities",CONTRACT:"/contracts"};
 if(["STUDENT_SUCCESS_RISK","STUDENT_SUCCESS_INTERVENTION"].includes(kind)&&uuid.test(details.caseId??""))return `/student-success?focus=${details.caseId}`;
 if(["ADMISSION_MILESTONE","WORKFLOW"].includes(kind)&&uuid.test(details.enrollmentId??""))return `/enrollments?focus=${details.enrollmentId}`;
 return direct[kind]??null;
}
