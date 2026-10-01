import { AutomationWorkspace } from "@/components/automation-workspace";
import { DataLoadError } from "@/components/data-state";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { loadAutomationWorkspace } from "@/lib/v220-repository";
import { AssistanceWorkspaceHeader } from "@/components/assistance-workspace-header";
export const generateMetadata=()=>localizedPageMetadata("meta.automation");
export default async function Page(){await requireCapability("automation.manage");const data=await loadAutomationWorkspace().catch(()=>null);return <div className="page-stack"><AssistanceWorkspaceHeader active="/automation"/>{data?<AutomationWorkspace initial={data}/>:<DataLoadError detailKey="automation.failed"/>}</div>;}
