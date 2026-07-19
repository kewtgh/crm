import { z } from "zod";

export const pagedSortSchema=z.enum(["primary","secondary","status","meta","extra","completeness"]);
export const pagedQuerySchema=z.object({
  query:z.string().max(100).catch(""),
  page:z.coerce.number().int().min(1).max(100_000).catch(1),
  pageSize:z.coerce.number().refine(value=>[10,20,50].includes(value)).catch(10),
  status:z.string().max(40).regex(/^[A-Za-z0-9_-]+$/).catch("all"),
  sort:pagedSortSchema.catch("primary"),
  direction:z.enum(["asc","desc"]).catch("asc"),
});

export type PagedQueryState=z.infer<typeof pagedQuerySchema>;

export function parsePagedSearchParams(params:Pick<URLSearchParams,"get">):PagedQueryState{
  return pagedQuerySchema.parse({
    query:params.get("q")??"",
    page:params.get("page")??1,
    pageSize:params.get("pageSize")??10,
    status:params.get("status")??"all",
    sort:params.get("sort")??"primary",
    direction:params.get("direction")??"asc",
  });
}
