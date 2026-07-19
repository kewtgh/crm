import { ImportsPage } from "@/components/imports-page";
import { DataLoadError } from "@/components/data-state";
import { listImportBatches } from "@/lib/phase2-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";
export async function generateMetadata(){return localizedPageMetadata("meta.imports");}
export default async function Page(){await requireCapability("imports.view");const data=await listImportBatches().catch(()=>null);return data?<ImportsPage initialItems={data.items} initialTotal={data.total}/>:<DataLoadError/>;}
