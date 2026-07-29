import { z } from "zod";

export const calendarActionSchema = z.union([
  z.object({ action: z.literal("COMPLETE") }),
  z.object({ action: z.literal("CANCEL") }),
  z.object({
    action: z.literal("UPDATE"),
    date: z.iso.date(),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
]);

export type CalendarAction = z.infer<typeof calendarActionSchema>;

export function parseCalendarAction(value: unknown) {
  return calendarActionSchema.safeParse(value);
}
