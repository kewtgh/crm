import {RecycleBinPage} from "@/components/recycle-bin-page";
import {requireUser} from "@/lib/auth";
import {loadRecyclePage} from "@/lib/recycle-bin-repository";
import {readRecycleQuery} from "@/lib/recycle-contract";

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requireUser();const params=await searchParams;
 const query=readRecycleQuery(new URLSearchParams(Object.entries(params).flatMap(([key,value])=>typeof value==="string"?[[key,value]]:[])));
 const initial=await loadRecyclePage("personal",query).catch(()=>null);
 return <RecycleBinPage initial={initial} initialQuery={query} personal/>;
}
