import { DataQualityPage } from "@/components/data-quality-page";
import { listQualityIssues } from "@/lib/phase2-repository";
export default async function Page(){const data=await listQualityIssues().catch(()=>({items:[],total:0}));return <DataQualityPage initialItems={data.items} initialTotal={data.total}/>;}
