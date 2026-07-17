import { ImportsPage } from "@/components/imports-page";
import { listImportBatches } from "@/lib/phase2-repository";
export default async function Page(){const data=await listImportBatches().catch(()=>({items:[],total:0}));return <ImportsPage initialItems={data.items} initialTotal={data.total} duplicatesOnly/>;}
