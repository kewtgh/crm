import { z } from "zod";

const actionDetails = z.union([
  z.object({ action: z.literal("COMPLETE") }),
  z.object({ action: z.literal("CANCEL") }),
  z.object({
    action: z.literal("UPDATE"),
    date: z.iso.date(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
]);

export const calendarActionSchema=actionDetails.and(z.object({expectedVersion:z.number().int().min(1),requestKey:z.string().trim().min(8).max(160)}));
export const appointmentCreateSchema=z.object({title:z.string().trim().min(1).max(160),locale:z.enum(["zh-CN","en"]),date:z.iso.date(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),type:z.enum(["meeting","consultation","followup","deadline"]),channel:z.string().trim().max(80),related:z.string().trim().max(160),relatedType:z.enum(["ORGANIZATION","CONTACT","USER"]).nullable().optional(),relatedId:z.uuid().nullable().optional(),reminder:z.number().int().min(0).max(43200),attendees:z.array(z.object({email:z.email(),name:z.string().trim().max(120).optional(),contactId:z.uuid().nullable().optional(),consentConfirmed:z.literal(true)})).max(50).default([]),requestKey:z.string().trim().min(8).max(160)}).refine(value=>Boolean(value.relatedType)===Boolean(value.relatedId),{path:["relatedId"],message:"INVALID_REFERENCE"});
export type AppointmentCreate=z.infer<typeof appointmentCreateSchema>;
export type CalendarAction = z.infer<typeof calendarActionSchema>;

export function parseCalendarAction(value: unknown) {
  return calendarActionSchema.safeParse(value);
}
