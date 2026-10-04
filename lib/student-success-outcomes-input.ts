import {z} from "zod";
import {successGoalTypes,successHealth} from "./student-success-input";
export const successOutcomeTypes=successGoalTypes;
export const successOutcomeResults=["ACHIEVED","PARTIALLY_ACHIEVED","NOT_ACHIEVED","OBSERVED"] as const;
export const successOutcomeDataSchema=z.object({case_id:z.uuid(),goal_id:z.uuid().nullable(),outcome_type:z.enum(successOutcomeTypes),result:z.enum(successOutcomeResults),occurred_on:z.iso.date(),title:z.string().trim().min(1).max(200),summary:z.string().trim().max(2000).nullable(),owner_id:z.uuid().nullable()}).strict();
export const successOutcomeSaveSchema=z.object({id:z.uuid(),expectedRevision:z.number().int().positive().max(2147483647).nullable(),requestKey:z.string().min(8).max(160),data:successOutcomeDataSchema}).strict();
export const successOutcomeVoidSchema=z.object({id:z.uuid(),caseId:z.uuid(),expectedRevision:z.number().int().positive().max(2147483647),requestKey:z.string().min(8).max(160),reason:z.string().trim().min(1).max(1000)}).strict();
export const successAnalyticsFiltersSchema=z.object({from:z.iso.date().optional(),to:z.iso.date().optional(),productId:z.uuid().optional(),cohortId:z.uuid().optional(),ownerId:z.uuid().optional(),health:z.enum(successHealth).optional()}).strict().refine(v=>!v.from||!v.to||v.from<=v.to).refine(v=>!v.from||!v.to||(Date.parse(v.to)-Date.parse(v.from))/86400000<=3660);
