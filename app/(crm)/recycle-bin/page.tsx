import {RecycleBinPage} from "@/components/recycle-bin-page";
import {DataLoadError} from "@/components/data-state";
import {requireUser} from "@/lib/auth";
import {listPersonalRecycleBin} from "@/lib/recycle-bin-repository";

export default async function Page(){
 await requireUser();
 const items=await listPersonalRecycleBin().catch(()=>null);
 return items?<RecycleBinPage initialItems={items} personal/>:<DataLoadError detailKey="recycle.loadFailed"/>;
}
