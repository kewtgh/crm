import {requireCapability} from "@/lib/auth";
import {WorkspaceTabs,reportTabs} from "@/components/workspace-tabs";
import {ManagementAttentionWorkspace} from "@/components/management-attention-workspace";
import {attentionFiltersSchema} from "@/lib/management-attention-contract";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireCapability("education.view");const parsed=attentionFiltersSchema.safeParse(await searchParams);return <div className="page-stack"><WorkspaceTabs items={reportTabs} active="/reports/executive"/><ManagementAttentionWorkspace initialFilters={parsed.success?parsed.data:{}}/></div>;}
