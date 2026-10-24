import {z} from "zod";
import {deletionResources} from "./record-deletion-contract";

export const recycleKinds=deletionResources.map(item=>item.kind);
export const recycleScopeSchema=z.enum(["personal","workspace"]);
export type RecycleScope=z.infer<typeof recycleScopeSchema>;
export const recycleDefaults={q:"",kind:"all",retention:"all",page:1,pageSize:20} as const;
export const recycleQuerySchema=z.object({
  q:z.string().max(100).default(""),kind:z.enum(["all",...recycleKinds]).default("all"),
  retention:z.enum(["all","eligible","retained"]).default("all"),
  page:z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize:z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export type RecycleQuery=z.infer<typeof recycleQuerySchema>;
export function readRecycleQuery(params:URLSearchParams):RecycleQuery {
  return Object.fromEntries(Object.entries(recycleDefaults).map(([key,fallback])=>{
    const raw=params.get(key),parsed=recycleQuerySchema.shape[key as keyof typeof recycleDefaults].safeParse(raw??fallback);
    return [key,parsed.success?parsed.data:fallback];
  })) as RecycleQuery;
}
export function writeRecycleQuery(params:URLSearchParams,query:RecycleQuery){
  const next=new URLSearchParams(params);
  for(const [key,fallback] of Object.entries(recycleDefaults)){
    const value=query[key as keyof RecycleQuery];if(value===fallback)next.delete(key);else next.set(key,String(value));
  }
  return next;
}
const timestamp=z.iso.datetime({offset:true});
export const recycleItemSchema=z.object({id:z.uuid(),kind:z.enum(recycleKinds),labelZh:z.string(),labelEn:z.string(),deletedAt:timestamp,purgeEligibleAt:timestamp.nullable()});
export type RecycleBinItem=z.infer<typeof recycleItemSchema>;
export const recyclePageSchema=z.object({items:z.array(recycleItemSchema),total:z.number().int().nonnegative(),page:z.number().int().positive(),pageSize:z.number().int().min(1).max(50),scope:recycleScopeSchema});
export type RecyclePage=z.infer<typeof recyclePageSchema>;
export const recycleRestoreSchema=z.object({scope:recycleScopeSchema,kind:z.enum(recycleKinds),id:z.uuid(),expectedDeletedAt:timestamp,requestKey:z.string().min(8).max(120).refine(value=>value===value.trim())}).strict();
export type RecycleRestore=z.infer<typeof recycleRestoreSchema>;
export const recycleRestoredSchema=z.object({id:z.uuid(),kind:z.enum(recycleKinds),restored:z.literal(true)}).strict();
export type RecycleRestored=z.infer<typeof recycleRestoredSchema>;
export function restoredRecordHref(item:Pick<RecycleBinItem,"kind"|"id">){
  if(!z.uuid().safeParse(item.id).success)return null;
  const paths:Partial<Record<RecycleBinItem["kind"],string>>={ORGANIZATION:"/schools/",CONTACT:"/people/",TASK:"/tasks/"};
  const path=paths[item.kind];return path?path+item.id:null;
}
