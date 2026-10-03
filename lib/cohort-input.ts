import { z } from "zod";
import { bilingualSchema } from "./bilingual-names";

export const cohortIntakes = ["SPRING", "SUMMER", "FALL", "WINTER", "CUSTOM"] as const;
export const cohortStatuses = ["DRAFT", "RECRUITING", "CLOSED", "ACTIVE", "COMPLETED", "CANCELLED"] as const;
const date = z.iso.date().nullable();
export const cohortDataSchema = bilingualSchema(z.object({
  productId: z.uuid(), code: z.string().trim().regex(/^[A-Za-z0-9-]{2,40}$/),
  nameZh: z.string().trim().max(120), nameEn: z.string().trim().max(120),
  intakeType: z.enum(cohortIntakes), academicYear: z.string().trim().max(40),
  applicationOpenOn: date, applicationDeadline: date, startOn: date, endOn: date,
  targetEnrollment: z.number().int().min(0).max(2147483647).nullable(),
  capacity: z.number().int().min(0).max(2147483647).nullable(),
  status: z.enum(cohortStatuses), defaultCurrency: z.string().regex(/^[A-Z]{3}$/), ownerId: z.uuid().nullable(),
}).strict()).superRefine((data, ctx) => {
  const dates = [data.applicationOpenOn, data.applicationDeadline, data.startOn, data.endOn].filter((value): value is string => value !== null);
  if (dates.some((value, index) => index > 0 && dates[index - 1] > value)) {
    ctx.addIssue({ code: "custom", path: ["applicationDeadline"], message: "cohort_dates_invalid" });
  }
  if (data.targetEnrollment !== null && data.capacity !== null && data.targetEnrollment > data.capacity) {
    ctx.addIssue({ code: "custom", path: ["targetEnrollment"], message: "cohort_capacity_invalid" });
  }
});
export type CohortData = z.infer<typeof cohortDataSchema>;
export const saveCohortSchema = z.object({
  id: z.uuid(), expectedRevision: z.number().int().positive().max(2147483647).nullable(),
  requestKey: z.string().min(8).max(160), data: cohortDataSchema,
}).strict();

export function cohortDatabaseData(data: CohortData) {
  return {
    product_id: data.productId, code: data.code, name_zh: data.nameZh, name_en: data.nameEn,
    intake_type: data.intakeType, academic_year: data.academicYear, application_open_on: data.applicationOpenOn,
    application_deadline: data.applicationDeadline, start_on: data.startOn, end_on: data.endOn,
    target_enrollment: data.targetEnrollment, capacity: data.capacity, status: data.status,
    default_currency: data.defaultCurrency, owner_id: data.ownerId,
  };
}
