import {MarketingExportPage} from "@/components/marketing-export-page";
import {localizedPageMetadata} from "@/lib/page-metadata";
export const generateMetadata=()=>localizedPageMetadata("meta.marketing");
export default function Page(){return <MarketingExportPage/>;}
