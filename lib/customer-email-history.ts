import { z } from "zod";

export const emailHistoryPurposes = ["SERVICE", "TRANSACTIONAL", "EVENT", "MARKETING"] as const;
export const emailHistoryStatuses = ["QUEUED", "PROCESSING", "SENT", "DELIVERED", "FAILED", "UNCERTAIN"] as const;
export const emailHistoryFilters = z.object({
  q: z.string().trim().max(160).default(""),
  purpose: z.enum(["", ...emailHistoryPurposes]).default(""),
  status: z.enum(["", ...emailHistoryStatuses]).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().refine(value => [10, 20, 50].includes(value)).default(20),
});
export type EmailHistoryFilters = z.infer<typeof emailHistoryFilters>;
export type EmailHistoryRecord = {
  id: string; threadId: string; contactZh: string; contactEn: string; email: string;
  subject: string; purpose: string; deliveryStatus: string; createdAt: string; deliveredAt: string | null;
};
export type EmailHistoryResult = { items: EmailHistoryRecord[]; total: number; page: number; pageSize: number };
