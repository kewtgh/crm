import { DataLoadError } from "@/components/data-state";
import { ModulePage } from "@/components/module-page";
import { moduleConfigs } from "@/lib/crm-data";
import { listCrmRows } from "@/lib/crm-repository";

export default async function Page() {
  const data = await listCrmRows("people", { pageSize: 10 }).catch(() => null);
  return data
    ? <ModulePage config={{ ...moduleConfigs.people, rows: data.items }} resource="people" initialTotal={data.total} initialMetrics={data.metrics} />
    : <DataLoadError />;
}
