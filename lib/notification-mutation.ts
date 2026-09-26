import { z } from "zod";

// An empty or malformed selection must never mean "all notifications".
export const notificationMutationSchema = z.union([
  z.object({ all: z.literal(true) }).strict(),
  z.object({ ids: z.array(z.uuid()).min(1).max(100) }).strict(),
]);

export type NotificationMutation = z.infer<typeof notificationMutationSchema>;

export function notificationReadFilter(input: NotificationMutation) {
  const operation = notificationMutationSchema.parse(input);
  return "all" in operation
    ? "read_at=is.null"
    : `read_at=is.null&id=in.(${[...new Set(operation.ids)].join(",")})`;
}
