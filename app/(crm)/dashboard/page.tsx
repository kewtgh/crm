import { DashboardPage } from "@/components/dashboard-page";
import { DataLoadError } from "@/components/data-state";
import { loadDashboard } from "@/lib/dashboard-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
export async function generateMetadata(){return localizedPageMetadata("meta.dashboard");}
export default async function Page(){const snapshot=await loadDashboard().catch(()=>null);return snapshot?<DashboardPage initialSnapshot={snapshot}/>:<DataLoadError/>;}
