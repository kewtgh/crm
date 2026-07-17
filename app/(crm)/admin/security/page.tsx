import { SecurityAdminPage } from "@/components/admin-pages";
import { DataLoadError } from "@/components/data-state";
import { listAdminAudits, loadAdminDashboard } from "@/lib/admin-dashboard-repository";
export default async function Page(){let result;try{result=await Promise.all([loadAdminDashboard(),listAdminAudits({page:1,pageSize:20})]);}catch{return <DataLoadError detailKey="admin.dashboardLoadFailed"/>;}return <SecurityAdminPage data={result[0]} initialAudits={result[1]}/>;}
