import { notFound } from "next/navigation";
import { PublicPortalPage } from "@/components/public-portal-page";
import { loadPublicPortal } from "@/lib/v220-repository";
export const dynamic="force-dynamic";
export const metadata={title:"Guardian portal | Lumina CRM",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{token:string}>}){const{token}=await params;if(!/^[A-Za-z0-9_-]{43}$/.test(token))notFound();const data=await loadPublicPortal(token).catch(()=>null);if(!data)notFound();return <PublicPortalPage token={token} initial={data}/>;}
