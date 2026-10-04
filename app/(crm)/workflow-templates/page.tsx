import {requireCapability} from "@/lib/auth";
import {localizedPageMetadata} from "@/lib/page-metadata";
import {listWorkflowTemplates} from "@/lib/workflow-template-repository";
import {WorkflowTemplatesWorkspace} from "@/components/workflow-templates-workspace";
import {WorkspaceTabs,familyTabs} from "@/components/workspace-tabs";
export const generateMetadata=()=>localizedPageMetadata("workflow.templates");
export default async function Page(){await requireCapability("education.view");const initial=await listWorkflowTemplates().catch(()=>null);return <div className="page-stack"><WorkspaceTabs items={familyTabs} active="/workflow-templates"/><WorkflowTemplatesWorkspace initial={initial}/></div>;}
