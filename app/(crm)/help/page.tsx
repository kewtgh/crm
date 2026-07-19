import { HelpPage } from "@/components/help-page"; export default function Page(){ return <HelpPage/>; }
import { localizedPageMetadata } from "@/lib/page-metadata";
export async function generateMetadata(){return localizedPageMetadata("meta.help");}
