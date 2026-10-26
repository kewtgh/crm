import {z} from "zod";
import {hasCapability,type Capability} from "./capabilities";
import type {AppRole} from "./roles";

export const globalRecordTypes=["ORGANIZATION","CONTACT","OPPORTUNITY","TASK","CONTRACT","QUOTE","PRODUCT","STUDENT","HOUSEHOLD","LEAD"] as const;
export type GlobalRecordType=typeof globalRecordTypes[number];
export const GLOBAL_SEARCH_LIMIT=16;
export const globalScopeSchema=z.enum(["all","pages",...globalRecordTypes]);
export type GlobalSearchScope=z.infer<typeof globalScopeSchema>;
export const globalSearchQuerySchema=z.object({q:z.string().trim().min(2).max(80).refine(value=>value.replace(/[,*()%_\\\s]/g,"").length>=2),type:globalScopeSchema.default("all")}).strict();
export const globalRecordSchema=z.object({id:z.uuid(),type:z.enum(globalRecordTypes),labelZh:z.string().max(300),labelEn:z.string().max(300)}).strict();
export type GlobalSearchRecord=z.infer<typeof globalRecordSchema>;
export const globalSearchResultSchema=z.object({query:z.string().min(2).max(80),scope:globalScopeSchema,items:z.array(globalRecordSchema).max(GLOBAL_SEARCH_LIMIT),sources:z.array(z.object({type:z.enum(globalRecordTypes),status:z.enum(["READY","FAILED"]),returned:z.number().int().min(0).max(8)}).strict()).max(globalRecordTypes.length),truncated:z.boolean()}).strict();
export type GlobalSearchResult=z.infer<typeof globalSearchResultSchema>;
const requirements:Record<GlobalRecordType,Capability|null>={ORGANIZATION:null,CONTACT:null,OPPORTUNITY:"opportunities.view",TASK:"tasks.view",CONTRACT:"contracts.view",QUOTE:"finance.view",PRODUCT:null,STUDENT:"education.view",HOUSEHOLD:"education.view",LEAD:"leads.view"};
export function visibleGlobalRecordTypes(role:AppRole){return globalRecordTypes.filter(type=>!requirements[type]||hasCapability(role,requirements[type]!));}
export function globalRecordHref(record:Pick<GlobalSearchRecord,"type"|"id">){
 const id=z.uuid().parse(record.id);
 switch(record.type){
  case "ORGANIZATION":return `/schools/${id}`;
  case "CONTACT":return `/people/${id}`;
  case "TASK":return `/tasks/${id}`;
  case "OPPORTUNITY":return `/opportunities?focus=${id}`;
  case "CONTRACT":return `/contracts?focus=${id}`;
  case "QUOTE":return `/finance?quote=${id}#quote-${id}`;
  case "PRODUCT":return `/products?focus=${id}`;
  case "STUDENT":return `/students?focus=${id}`;
  case "HOUSEHOLD":return `/households?tab=families&focus=${id}`;
  case "LEAD":return `/leads?focus=${id}`;
  default:throw new Error("GLOBAL_SEARCH_TYPE_INVALID");
 }
}
export function interleaveGlobalResults(groups:GlobalSearchRecord[][],query:string,limit=GLOBAL_SEARCH_LIMIT){
 const normalized=query.normalize("NFKC").toLowerCase();
 const score=(item:GlobalSearchRecord)=>{const labels=[item.labelZh,item.labelEn].map(value=>value.normalize("NFKC").toLowerCase());return labels.some(value=>value===normalized)?0:labels.some(value=>value.startsWith(normalized))?1:2;};
 const sorted=groups.map(group=>Array.from(new Map(group.map(item=>[item.id,item])).values()).sort((a,b)=>score(a)-score(b)||a.id.localeCompare(b.id)));
 const items:GlobalSearchRecord[]=[];
 for(let index=0;items.length<limit&&sorted.some(group=>index<group.length);index++)for(const group of sorted){if(group[index]&&items.length<limit)items.push(group[index]);}
 return{items,truncated:sorted.reduce((sum,group)=>sum+group.length,0)>items.length};
}
