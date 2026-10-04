import { z } from "zod";
import { bilingualSchema } from "./bilingual-names";
export const automationTriggers=["LEAD_CREATED","LEAD_STATUS_CHANGED","OPPORTUNITY_STAGE_CHANGED","CONTRACT_RENEWAL_DUE","MANUAL","ENROLLMENT_CREATED","ENROLLMENT_STATUS_CHANGED","COHORT_APPLICATION_DEADLINE_APPROACHING","APPLICATION_CREATED","APPLICATION_STATUS_CHANGED","MILESTONE_STATUS_CHANGED","MILESTONE_DUE_APPROACHING","WORKFLOW_STARTED","WORKFLOW_STEP_READY","WORKFLOW_COMPLETED"] as const;
const trigger=z.enum(automationTriggers);
export const automationInputSchema=bilingualSchema(z.discriminatedUnion("operation",[
  z.object({operation:z.literal("create"),nameZh:z.string().trim().max(160).default(""),nameEn:z.string().trim().max(160).default(""),triggerKey:trigger,conditionField:z.enum(["status","source","stage","currency","daysUntilDeadline"]).optional(),conditionValue:z.string().trim().max(160).optional(),actionType:z.enum(["TASK","NOTIFICATION"]),titleZh:z.string().trim().max(160).default(""),titleEn:z.string().trim().max(160).default(""),priority:z.enum(["LOW","NORMAL","HIGH","URGENT"]),dueHours:z.number().int().min(1).max(2160)}).refine(value=>value.conditionField!=="daysUntilDeadline"||/^\d{1,4}$/.test(value.conditionValue??""),{path:["conditionValue"],message:"deadline_days_invalid"}),
  z.object({operation:z.literal("toggle"),id:z.uuid(),active:z.boolean()}),
  z.object({operation:z.literal("run"),triggerKey:trigger,eventKey:z.string().trim().min(8).max(240),payload:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).default({})}),
  z.object({operation:z.literal("preview"),id:z.uuid(),payload:z.record(z.string(),z.union([z.string(),z.number(),z.boolean(),z.null()])).default({})}),
  z.object({operation:z.literal("retry"),id:z.uuid()}),
])).refine(value=>value.operation!=="create"||(value.titleZh.length>=2&&value.titleEn.length>=2),{path:["titleZh"],message:"action_title_too_short"});
