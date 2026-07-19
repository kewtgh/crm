import { z } from "zod";

export const sortKeySchema = z.enum(["primary", "secondary", "status", "meta", "extra", "completeness"]);

export const viewConfigSchema = z.object({
  version: z.literal(1),
  query: z.string().max(100),
  status: z.string().max(40),
  sort: sortKeySchema,
  direction: z.enum(["asc", "desc"]),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]),
}).strict();

export const savedViewSchema = viewConfigSchema.extend({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  visibility: z.enum(["PERSONAL", "TEAM"]),
  source: z.enum(["LOCAL", "SERVER"]),
  owned: z.boolean(),
});

export type SavedView = z.infer<typeof savedViewSchema>;
export type ViewConfig = z.infer<typeof viewConfigSchema>;
