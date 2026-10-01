import { ReportsHubPage } from "@/components/feature-status-page";
import { WorkspaceTabs,reportTabs } from "@/components/workspace-tabs";
export default function Page(){return <div className="page-stack"><WorkspaceTabs items={reportTabs} active="/reports"/><ReportsHubPage/></div>;}
import { localizedPageMetadata } from "@/lib/page-metadata";
export async function generateMetadata(){return localizedPageMetadata("meta.reports");}
