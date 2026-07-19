import { DataLoadError } from "@/components/data-state";
import { Customer360Page } from "@/components/customer-360-page";
import { loadOrganization360 } from "@/lib/phase2-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
export const generateMetadata=()=>localizedPageMetadata("meta.schools");
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;const data=await loadOrganization360(id).catch(()=>null);return data?<Customer360Page initial={data}/>:<DataLoadError/>;}
