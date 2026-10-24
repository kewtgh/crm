import {notFound} from "next/navigation";
import {RecycleBinPage} from "@/components/recycle-bin-page";
import {getCurrentUser} from "@/lib/auth";
import {loadRecyclePage} from "@/lib/recycle-bin-repository";
import {readRecycleQuery} from "@/lib/recycle-contract";

export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=await getCurrentUser();if(user?.role!=="SUPER_ADMIN")notFound();const params=await searchParams;
 const query=readRecycleQuery(new URLSearchParams(Object.entries(params).flatMap(([key,value])=>typeof value==="string"?[[key,value]]:[])));
 const initial=await loadRecyclePage("workspace",query).catch(()=>null);
 return <RecycleBinPage initial={initial} initialQuery={query}/>;
}
