import { DataLoadError } from "@/components/data-state";
import { ExportsPage } from "@/components/exports-page";
import { WorkspaceTabs,reportTabs } from "@/components/workspace-tabs";
import { listGeneratedJobs } from "@/lib/generated-jobs-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata=()=>localizedPageMetadata("meta.exports");

export default async function Page(){let result;try{result=await listGeneratedJobs({page:1,pageSize:10});}catch{return <DataLoadError detailKey="exports.loadFailed"/>;}return <div className="page-stack"><WorkspaceTabs items={reportTabs} active="/reports/exports"/><ExportsPage initialPage={result}/></div>;}
