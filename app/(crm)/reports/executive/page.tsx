import {ExecutiveOverviewPage} from "@/components/executive-overview-page";
import {WorkspaceTabs,reportTabs} from "@/components/workspace-tabs";
import {requireCapability} from "@/lib/auth";
import {overviewFiltersSchema} from "@/lib/management-trend-contract";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requireCapability("education.view");const parsed=overviewFiltersSchema.safeParse(await searchParams);
 return <div className="page-stack"><WorkspaceTabs items={reportTabs} active="/reports/executive"/><ExecutiveOverviewPage initialFilters={parsed.success?parsed.data:{}}/></div>;
}
