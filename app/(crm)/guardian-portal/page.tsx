import { PortalWorkspace } from "@/components/portal-workspace";
import { DataLoadError } from "@/components/data-state";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { loadPortalWorkspace } from "@/lib/v220-repository";
export const generateMetadata=()=>localizedPageMetadata("meta.portal");
export default async function Page(){await requireCapability("portal.manage");const data=await loadPortalWorkspace().catch(()=>null);return data?<PortalWorkspace initial={data}/>:<DataLoadError detailKey="portal.failed"/>;}
