import { DataLoadError } from "@/components/data-state";
import { ModulePage } from "@/components/module-page";
import { moduleConfigs } from "@/lib/crm-data";
import { listCrmRows } from "@/lib/crm-repository";

export default async function Page() {
  const data = await listCrmRows("tasks", { pageSize: 5 }).catch(() => null);
  return data
    ? <ModulePage config={{ ...moduleConfigs.tasks, rows: data.items }} resource="tasks" initialTotal={data.total} />
    : <DataLoadError />;
}
