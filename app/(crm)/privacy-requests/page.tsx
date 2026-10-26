import {PrivacyRequestsWorkspace} from "@/components/privacy-requests-workspace";
import {requireUser} from "@/lib/auth";
import {localizedPageMetadata} from "@/lib/page-metadata";
import {listPrivacyRequests} from "@/lib/privacy-request-repository";
import {readPrivacyView} from "@/lib/privacy-request-contract";
export const generateMetadata=()=>localizedPageMetadata("meta.privacyRequests");
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 await requireUser();const view=readPrivacyView(await searchParams),data=await listPrivacyRequests(view).catch(()=>null);
 return <PrivacyRequestsWorkspace initial={data} initialView={view}/>;
}
