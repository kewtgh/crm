import { z } from "zod";

export const enrollmentStatuses = ["LEAD", "INTERESTED", "REGISTERING", "ACTIVE", "COMPLETED", "WITHDRAWN", "CANCELLED"] as const;
const timestamp = z.iso.datetime({offset: true}).nullable();
export const enrollmentDataSchema = z.object({
  student_id: z.uuid(), cohort_id: z.uuid(), household_id: z.uuid().nullable(), opportunity_id: z.uuid().nullable(),
  status: z.enum(enrollmentStatuses), owner_id: z.uuid(), sales_owner_id: z.uuid().nullable(),
  enrolled_at: timestamp, completed_at: timestamp, withdrawn_at: timestamp,
  withdrawal_reason: z.string().trim().max(1000),
}).strict().superRefine((data, ctx) => {
  const issue = (field: string) => ctx.addIssue({code: "custom", path: [field], message: "ENROLLMENT_LIFECYCLE_INVALID"});
  if (["ACTIVE", "COMPLETED"].includes(data.status) && !data.enrolled_at) issue("enrolled_at");
  if (data.status === "COMPLETED" && !data.completed_at) issue("completed_at");
  if (data.completed_at && (!data.enrolled_at || Date.parse(data.completed_at) < Date.parse(data.enrolled_at))) issue("completed_at");
  if (data.status === "WITHDRAWN" && (!data.withdrawn_at || !data.withdrawal_reason)) issue("withdrawal_reason");
  if (data.withdrawn_at && data.enrolled_at && Date.parse(data.withdrawn_at) < Date.parse(data.enrolled_at)) issue("withdrawn_at");
});
export type EnrollmentData = z.infer<typeof enrollmentDataSchema>;
export const enrollmentSaveSchema = z.object({
  id: z.uuid(), expectedRevision: z.number().int().positive().max(2147483647).nullable(),
  requestKey: z.string().min(8).max(160), statusReason: z.string().trim().max(1000).default(""), data: enrollmentDataSchema,
}).strict();
export const attributionSources = ["source_organization_id", "source_contact_id", "source_event_id", "source_campaign_id", "source_referral_id"] as const;
export const attributionDataSchema = z.object({
  enrollment_id: z.uuid(), attribution_type: z.enum(["PRIMARY", "ASSIST"]),
  source_organization_id: z.uuid().nullable(), source_contact_id: z.uuid().nullable(), source_event_id: z.uuid().nullable(),
  source_campaign_id: z.uuid().nullable(), source_referral_id: z.uuid().nullable(), note: z.string().trim().max(1000),
}).strict().refine(data => attributionSources.some(field => data[field] !== null), {path: ["source_organization_id"], message: "ENROLLMENT_SOURCE_REQUIRED"});
export const attributionSaveSchema = z.object({id: z.uuid(), requestKey: z.string().min(8).max(160), data: attributionDataSchema}).strict();
export type AttributionData = z.infer<typeof attributionDataSchema>;
export const enrollmentLookupTypes = ["COHORT", "EVENT", "CAMPAIGN", "REFERRAL"] as const;
export type EnrollmentLookupType = typeof enrollmentLookupTypes[number];

// Preserve the original precise timestamp if the visible datetime input was not edited.
export function enrollmentTimestamp(value: string, original: string | null, localValue: (value: string) => string, toIso: (value: string) => string) {
  if (!value) return null;
  if (original && value === localValue(original)) return original;
  return toIso(value);
}
