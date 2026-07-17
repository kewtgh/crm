import { AdminPortalPage } from "@/components/admin-pages";
import { DataLoadError } from "@/components/data-state";
import { loadAdminDashboard } from "@/lib/admin-dashboard-repository";
export default async function Page(){let data;try{data=await loadAdminDashboard();}catch{return <DataLoadError detailKey="admin.dashboardLoadFailed"/>;}return <AdminPortalPage data={data}/>;}
