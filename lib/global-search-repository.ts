import {databaseJson} from "./db/gateway";
import {searchRelatedRecords} from "./related-search-repository";
import {globalRecordSchema,globalSearchQuerySchema,interleaveGlobalResults,visibleGlobalRecordTypes,type GlobalSearchResult,type GlobalSearchScope} from "./global-search-contract";
import type {AppRole} from "./roles";

export async function searchGlobalRecords(input:{q:string;type?:GlobalSearchScope},role:AppRole,request=databaseJson):Promise<GlobalSearchResult>{
 const query=globalSearchQuerySchema.parse(input),allowed=visibleGlobalRecordTypes(role);
 if(query.type!=="all"&&query.type!=="pages"&&!allowed.some(type=>type===query.type))throw new Error("GLOBAL_SEARCH_SCOPE_FORBIDDEN");
 const types=query.type==="pages"?[]:query.type==="all"?allowed:allowed.filter(type=>type===query.type);
 const groups=await Promise.all(types.map(async type=>{
  try{
   const rows=await searchRelatedRecords(query.q,[type],undefined,request);
   if(rows.length>8)throw new Error("GLOBAL_SEARCH_SOURCE_INVALID");
   const records=rows.map(row=>{if(row.type!==type||!row.value.startsWith(type+":"))throw new Error("GLOBAL_SEARCH_SOURCE_INVALID");return globalRecordSchema.parse({id:row.value.slice(type.length+1),type,labelZh:row.labelZh,labelEn:row.labelEn});});
   return{records,source:{type,status:"READY" as const,returned:records.length}};
  }catch{return{records:[],source:{type,status:"FAILED" as const,returned:0}};}
 }));
 return{query:query.q,scope:query.type,...interleaveGlobalResults(groups.map(group=>group.records),query.q),sources:groups.map(group=>group.source)};
}
