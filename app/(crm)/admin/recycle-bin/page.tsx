import {notFound} from "next/navigation";
import {RecycleBinPage} from "@/components/recycle-bin-page";
import {DataLoadError} from "@/components/data-state";
import {getCurrentUser} from "@/lib/auth";
import {listRecycleBin} from "@/lib/recycle-bin-repository";

export default async function Page(){
  const user=await getCurrentUser();
  if(user?.role!=="SUPER_ADMIN")notFound();
  const items=await listRecycleBin().catch(()=>null);
  return items?<RecycleBinPage initialItems={items}/>:<DataLoadError detailKey="recycle.loadFailed"/>;
}
