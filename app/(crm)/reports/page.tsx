import { ReportsHubPage } from "@/components/feature-status-page"; export default function Page(){ return <ReportsHubPage/>; }
import { localizedPageMetadata } from "@/lib/page-metadata";
export async function generateMetadata(){return localizedPageMetadata("meta.reports");}
