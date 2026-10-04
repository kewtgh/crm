import {z} from "zod";
import {milestoneTypes} from "./admission-milestone-input";
export const workflowKinds=["TASK","MILESTONE","CHECKPOINT"] as const;
export const workflowBases=["WORKFLOW_START","COHORT_APPLICATION_DEADLINE","COHORT_START","APPLICATION_DEADLINE"] as const;
export const workflowCheckpoints=["APPLICATION_SUBMITTED","APPLICATION_DECIDED","MILESTONE_COMPLETED"] as const;
export const workflowTemplateStatuses=["DRAFT","ACTIVE","RETIRED"] as const;
const name=z.string().trim().max(160),names={name_zh:name,name_en:name},taskConfig=z.object({title_zh:name,title_en:name,description:z.string().trim().max(1000).default(""),priority:z.enum(["LOW","NORMAL","HIGH","URGENT"]).default("NORMAL")}).strict().refine(v=>!!(v.title_zh||v.title_en));
const milestoneConfig=z.object({milestone_type:z.enum(milestoneTypes),default_status:z.literal("PENDING").default("PENDING"),application_scope:z.enum(["ENROLLMENT","APPLICATION"])}).strict();
const checkpointConfig=z.object({checkpoint_type:z.enum(workflowCheckpoints),milestone_type:z.enum(milestoneTypes).optional(),application_scope:z.enum(["ENROLLMENT","APPLICATION"]).default("APPLICATION")}).strict().refine(v=>v.checkpoint_type==="MILESTONE_COMPLETED"?!!v.milestone_type:!v.milestone_type&&v.application_scope==="APPLICATION");
const baseStep=z.object({id:z.uuid(),sequence:z.number().int().min(1).max(1000000),...names,required:z.boolean(),default_owner_role:z.enum(["SUPER_ADMIN","ADMIN","SALES_DIRECTOR","SALES_MANAGER","SALES_SPECIALIST","SALES_SUPPORT"]).nullable(),offset_basis:z.enum(workflowBases).nullable(),offset_days:z.number().int().min(-3650).max(3650).nullable()}).strict();
export const workflowStepSchema=z.discriminatedUnion("step_kind",[
 baseStep.extend({step_kind:z.literal("TASK"),task_config:taskConfig,milestone_config:z.null(),checkpoint_config:z.null()}),
 baseStep.extend({step_kind:z.literal("MILESTONE"),task_config:z.null(),milestone_config:milestoneConfig,checkpoint_config:z.null()}),
 baseStep.extend({step_kind:z.literal("CHECKPOINT"),task_config:z.null(),milestone_config:z.null(),checkpoint_config:checkpointConfig})
]).refine(v=>!!(v.name_zh||v.name_en),{message:"WORKFLOW_INPUT_INVALID"}).refine(v=>(v.offset_basis===null)===(v.offset_days===null),{message:"WORKFLOW_INPUT_INVALID"});
export const workflowTemplateDataSchema=z.object({...names,product_id:z.uuid().nullable(),workflow_type:z.literal("ADMISSIONS").default("ADMISSIONS"),description:z.string().trim().max(2000).default(""),steps:z.array(workflowStepSchema).min(1).max(40)}).strict().refine(v=>!!(v.name_zh||v.name_en)).refine(v=>new Set(v.steps.map(s=>s.sequence)).size===v.steps.length&&new Set(v.steps.map(s=>s.id)).size===v.steps.length);
export const workflowTemplateSaveSchema=z.object({id:z.uuid(),expectedRevision:z.number().int().positive().nullable(),requestKey:z.string().min(8).max(160),data:workflowTemplateDataSchema}).strict();
export const workflowTemplateActionSchema=z.object({id:z.uuid(),expectedRevision:z.number().int().positive(),requestKey:z.string().min(8).max(160),operation:z.enum(["ACTIVATE","RETIRE","NEW_VERSION"]),newId:z.uuid().optional()}).strict().refine(v=>v.operation!=="NEW_VERSION"||!!v.newId);
export const workflowStartSchema=z.object({id:z.uuid(),templateId:z.uuid(),templateVersion:z.number().int().positive(),enrollmentId:z.uuid(),applicationId:z.uuid().nullable(),ownerId:z.uuid(),requestKey:z.string().min(8).max(160)}).strict();
export const workflowActionSchema=z.object({id:z.uuid(),expectedRevision:z.number().int().positive(),requestKey:z.string().min(8).max(160),operation:z.enum(["CANCEL","WAIVE","CANCEL_STEP"]),stepId:z.uuid().optional(),reason:z.string().trim().min(3).max(500)}).strict().refine(v=>v.operation==="CANCEL"||!!v.stepId);
export type WorkflowStep=z.infer<typeof workflowStepSchema>;
export type WorkflowTemplateData=z.infer<typeof workflowTemplateDataSchema>;
