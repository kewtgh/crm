import { DataLoadError } from "@/components/data-state";
import { CommunicationsInboxPage } from "@/components/communications-inbox-page";
import { loadCommunications,loadCommunicationThread } from "@/lib/v220-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
export const generateMetadata=()=>localizedPageMetadata("meta.messages");
export default async function Page(){await requireCapability("messages.view");const result=await loadCommunications().catch(()=>null);if(!result)return <DataLoadError detailKey="communications.failed"/>;const selected=result.items[0]?await loadCommunicationThread(result.items[0].id).catch(()=>null):null;return <CommunicationsInboxPage initial={result} initialThread={selected}/>;}
