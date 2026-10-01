import { DataLoadError } from "@/components/data-state";
import { CommunicationsInboxPage } from "@/components/communications-inbox-page";
import { CustomerEmailPanel } from "@/components/customer-email-panel";
import { PortalWorkspace } from "@/components/portal-workspace";
import { WorkspaceTabs,communicationTabs } from "@/components/workspace-tabs";
import { loadPortalWorkspace } from "@/lib/v220-repository";
import { loadCommunications,loadCommunicationThread } from "@/lib/v220-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
export const generateMetadata=()=>localizedPageMetadata("meta.messages");
export default async function Page({searchParams}:{searchParams:Promise<{tab?:string;thread?:string}>}){
  const {tab,thread}=await searchParams;
  const active=tab==="portal"?"/messages?tab=portal":tab==="templates"?"/messages?tab=templates":"/messages";
  let content:React.ReactNode;
  if(tab==="portal"){await requireCapability("portal.manage");const data=await loadPortalWorkspace().catch(()=>null);content=data?<PortalWorkspace initial={data}/>:<DataLoadError detailKey="portal.failed"/>;}
  else if(tab==="templates"){await requireCapability("messages.manage");content=<CustomerEmailPanel/>;}
  else{await requireCapability("messages.view");const result=await loadCommunications().catch(()=>null);const selectedId=thread||result?.items[0]?.id;const selected=selectedId?await loadCommunicationThread(selectedId).catch(()=>null):null;content=result?<CommunicationsInboxPage initial={result} initialThread={selected}/>:<DataLoadError detailKey="communications.failed"/>;}
  return <div className="page-stack"><WorkspaceTabs items={communicationTabs} active={active}/>{content}</div>;
}
