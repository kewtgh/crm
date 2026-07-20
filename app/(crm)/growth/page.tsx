import { GrowthWorkspace } from "@/components/growth-workspace";
import { DataLoadError } from "@/components/data-state";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { loadGrowthSnapshot } from "@/lib/v220-repository";
export const generateMetadata=()=>localizedPageMetadata("meta.growth");
export default async function Page(){await requireCapability("leads.view");const data=await loadGrowthSnapshot().catch(()=>null);return data?<GrowthWorkspace initial={data}/>:<DataLoadError detailKey="growth.failed"/>;}
