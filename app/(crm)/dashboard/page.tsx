import { DashboardPage } from "@/components/dashboard-page";
import { DataLoadError } from "@/components/data-state";
import { loadDashboard } from "@/lib/dashboard-repository";
export default async function Page(){const snapshot=await loadDashboard().catch(()=>null);return snapshot?<DashboardPage initialSnapshot={snapshot}/>:<DataLoadError/>;}
