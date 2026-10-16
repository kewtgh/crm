import { z } from "zod";
import { organizationFilterDefaults, contactFilterDefaults } from "./directory-filter-query";

export const sortKeySchema = z.enum(["primary", "secondary", "status", "meta", "extra", "completeness"]);

const filterValue = z.string().max(120);
export const savedDirectoryFiltersSchema = z.object({
  commercialTier:filterValue.optional(), keyContact:filterValue.optional(), ownerId:filterValue.optional(),
  potentialMin:filterValue.optional(), city:filterValue.optional(), curriculum:filterValue.optional(),
  organizationType:filterValue.optional(), organizationId:filterValue.optional(), contactType:filterValue.optional(),
}).strict();

export const viewConfigSchema = z.object({
  version: z.union([z.literal(1),z.literal(2)]),
  query: z.string().max(100),
  status: z.string().max(40),
  sort: sortKeySchema,
  direction: z.enum(["asc", "desc"]),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]),
  filters:savedDirectoryFiltersSchema.optional(),
}).strict().superRefine((value,context)=>{
  if((value.version===2)!==Boolean(value.filters))context.addIssue({code:"custom",path:["filters"],message:"VIEW_FILTER_VERSION_INVALID"});
});

export const savedViewSchema = viewConfigSchema.safeExtend({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  visibility: z.enum(["PERSONAL", "TEAM"]),
  source: z.enum(["LOCAL", "SERVER"]),
  owned: z.boolean(),
});

export type SavedView = z.infer<typeof savedViewSchema>;
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export function directoryDefaultsFor(resource?:string):Record<string,string>{
  return resource==="schools"?{...organizationFilterDefaults}:resource==="people"?{...contactFilterDefaults}:{};
}

/** A shared view may restore filters, never introduce a new API query key. */
export function viewMatchesResource(config:ViewConfig,resource?:string){
  const defaults=directoryDefaultsFor(resource);
  return Object.keys(config.filters??{}).every(key=>Object.hasOwn(defaults,key));
}

export function restoredViewFilters(config:ViewConfig,resource:string|undefined,current:Record<string,string>){
  if(config.version===1)return current; // Preserve the documented legacy independent-filter behavior.
  const defaults=directoryDefaultsFor(resource);
  return {...defaults,...Object.fromEntries(Object.entries(config.filters??{}).filter(([key])=>Object.hasOwn(defaults,key)))} as Record<string,string>;
}
