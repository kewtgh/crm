import { ContactConsentPage } from "@/components/contact-consent-page";
import { CustomerOperationsPanel } from "@/components/customer-operations-panel";
import { CrmRecordEditor } from "@/components/crm-record-editor";
import { DataLoadError } from "@/components/data-state";
import { loadContactPrivacy } from "@/lib/phase2-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
export const generateMetadata=()=>localizedPageMetadata("meta.people");
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;const data=await loadContactPrivacy(id).catch(()=>null);return data?<div className="page-stack"><section className="page-heading-row"><h1>{data.nameZh} / {data.nameEn}</h1><CrmRecordEditor resource="people" id={id}/></section><CustomerOperationsPanel subject="CONTACT" id={id} extra={<ContactConsentPage initial={data}/>}/></div>:<DataLoadError/>;}
