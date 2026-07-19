import { DataQualityPage } from "@/components/data-quality-page";
import { DataLoadError } from "@/components/data-state";
import { listQualityIssues } from "@/lib/phase2-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
export async function generateMetadata(){return localizedPageMetadata("meta.quality");}
export default async function Page(){const data=await listQualityIssues().catch(()=>null);return data?<DataQualityPage initialItems={data.items} initialTotal={data.total}/>:<DataLoadError/>;}
