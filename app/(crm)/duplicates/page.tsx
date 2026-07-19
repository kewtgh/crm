import { ImportsPage } from "@/components/imports-page";
import { DataLoadError } from "@/components/data-state";
import { listImportBatches } from "@/lib/phase2-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
export async function generateMetadata(){return localizedPageMetadata("meta.duplicates");}
export default async function Page(){const data=await listImportBatches().catch(()=>null);return data?<ImportsPage initialItems={data.items} initialTotal={data.total} duplicatesOnly/>:<DataLoadError/>;}
