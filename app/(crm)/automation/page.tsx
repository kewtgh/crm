import { AutomationWorkspace } from "@/components/automation-workspace";
import { DataLoadError } from "@/components/data-state";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { loadAutomationWorkspace } from "@/lib/v220-repository";
export const generateMetadata=()=>localizedPageMetadata("meta.automation");
export default async function Page(){await requireCapability("automation.manage");const data=await loadAutomationWorkspace().catch(()=>null);return data?<AutomationWorkspace initial={data}/>:<DataLoadError detailKey="automation.failed"/>;}
