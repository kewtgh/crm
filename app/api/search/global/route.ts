import {NextResponse} from "next/server";
import {apiRoute,requireApiUser} from "@/lib/api";
import {globalSearchQuerySchema,visibleGlobalRecordTypes} from "@/lib/global-search-contract";
import {searchGlobalRecords} from "@/lib/global-search-repository";

async function get(request:Request){
 const user=await requireApiUser(),params=new URL(request.url).searchParams;
 if(Array.from(params.keys()).length!==new Set(params.keys()).size)return NextResponse.json({code:"GLOBAL_SEARCH_QUERY_INVALID"},{status:400});
 const parsed=globalSearchQuerySchema.safeParse(Object.fromEntries(params));
 if(!parsed.success)return NextResponse.json({code:"GLOBAL_SEARCH_QUERY_INVALID"},{status:400});
 const scope=parsed.data.type;
 if(scope!=="all"&&scope!=="pages"&&!visibleGlobalRecordTypes(user.role).some(type=>type===scope))return NextResponse.json({code:"GLOBAL_SEARCH_SCOPE_FORBIDDEN"},{status:403});
 return NextResponse.json(await searchGlobalRecords(parsed.data,user.role),{headers:{"cache-control":"private, no-store"}});
}
export const GET=apiRoute(get,"GLOBAL_SEARCH_FAILED");
