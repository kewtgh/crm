import { DataLoadError } from "@/components/data-state";
import { ModulePage } from "@/components/module-page";
import { moduleConfigs } from "@/lib/crm-data";
import { listCrmRows } from "@/lib/crm-repository";
import { localizedPageMetadata } from "@/lib/page-metadata";
export async function generateMetadata(){return localizedPageMetadata("meta.schools");}

export default async function Page() {
  const data = await listCrmRows("schools", { pageSize: 10 }).catch(() => null);
  return data
    ? <ModulePage config={{ ...moduleConfigs.schools, rows: data.items }} resource="schools" initialTotal={data.total} initialMetrics={data.metrics} />
    : <DataLoadError />;
}
