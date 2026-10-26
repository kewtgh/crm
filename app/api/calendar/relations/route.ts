import {NextResponse} from "next/server";
import {z} from "zod";
import {apiRoute,requireApiCapability} from "@/lib/api";
import {databaseJson} from "@/lib/db/gateway";
import {searchRelatedRecords,type RelatedSearchRecord} from "@/lib/related-search-repository";
async function get(request:Request){
 await requireApiCapability("calendar.manage");const query=z.string().trim().max(80).safeParse(new URL(request.url).searchParams.get('q')??'');if(!query.success)return NextResponse.json({code:'INVALID_SEARCH'},{status:400});
 const [related,members]=await Promise.allSettled([searchRelatedRecords(query.data,['ORGANIZATION','CONTACT']),databaseJson<Array<{user_id:string;display_name_zh:string;display_name_en:string}>>('/db/rpc/list_calendar_members',{method:'POST',body:JSON.stringify({p_query:query.data})})]);
 const items:RelatedSearchRecord[]=related.status==='fulfilled'?related.value:[];if(members.status==='fulfilled')items.push(...members.value.map(row=>({value:'USER:'+z.uuid().parse(row.user_id),type:'USER' as const,labelZh:row.display_name_zh,labelEn:row.display_name_en})));
 return NextResponse.json({items,unavailable:related.status==='rejected'||members.status==='rejected'},{headers:{'cache-control':'private, no-store'}});
}
export const GET=apiRoute(get,'CALENDAR_RELATIONS_FAILED');
