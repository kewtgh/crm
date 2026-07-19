import { ContactConsentPage } from "@/components/contact-consent-page";
import { DataLoadError } from "@/components/data-state";
import { loadContactPrivacy } from "@/lib/phase2-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
export const generateMetadata=()=>localizedPageMetadata("meta.people");
export default async function Page({params}:{params:Promise<{id:string}>}){const{id}=await params;const data=await loadContactPrivacy(id).catch(()=>null);return data?<ContactConsentPage initial={data}/>:<DataLoadError/>;}
