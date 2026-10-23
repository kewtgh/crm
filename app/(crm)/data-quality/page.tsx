import { DataQualityPage } from "@/components/data-quality-page";
import { DataLoadError } from "@/components/data-state";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
import {loadQualityWorkspace} from "@/lib/quality-workspace-repository";
export async function generateMetadata(){return localizedPageMetadata("meta.quality");}
export default async function Page(){const user=await requireCapability("dataQuality.manage");const data=await loadQualityWorkspace({actorId:user.id}).catch(()=>null);return <div className="page-stack">{data?<DataQualityPage initialItems={data.items} initialTotal={data.total} initialTrend={data.trend} initialRules={data.rules} initialUnavailable={data.unavailable}/>:<DataLoadError/>}</div>;}
