import { DataLoadError } from "@/components/data-state";
import { CommunicationsInboxPage } from "@/components/communications-inbox-page";
import { loadCommunications } from "@/lib/v220-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
export const generateMetadata=()=>localizedPageMetadata("meta.messages");
export default async function Page(){await requireCapability("messages.view");const result=await loadCommunications().catch(()=>null);return result?<CommunicationsInboxPage initial={result}/>:<DataLoadError detailKey="communications.failed"/>;}
