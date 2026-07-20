import { DataQualityPage } from "@/components/data-quality-page";
import { DataLoadError } from "@/components/data-state";
import { listQualityIssues } from "@/lib/phase2-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
import { loadQualityRules,loadQualityTrend } from "@/lib/v220-repository";
export async function generateMetadata(){return localizedPageMetadata("meta.quality");}
export default async function Page(){await requireCapability("dataQuality.manage");const data=await Promise.all([listQualityIssues(),loadQualityTrend(),loadQualityRules()]).catch(()=>null);return data?<DataQualityPage initialItems={data[0].items} initialTotal={data[0].total} initialTrend={data[1]} initialRules={data[2]}/>:<DataLoadError/>;}
