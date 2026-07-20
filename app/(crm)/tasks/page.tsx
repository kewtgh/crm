import { DataLoadError } from "@/components/data-state";
import { ModulePage } from "@/components/module-page";
import { moduleConfigs } from "@/lib/crm-data";
import { listCrmRows } from "@/lib/crm-repository";
import { loadTaskWorkspace } from "@/lib/task-workspace-repository";
import { TaskWorkspacePanel } from "@/components/task-workspace";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { requireCapability } from "@/lib/auth";

export async function generateMetadata(){return localizedPageMetadata("meta.tasks");}

export default async function Page() {
  await requireCapability("tasks.view");
  const result = await Promise.all([listCrmRows("tasks", { pageSize: 10 }),loadTaskWorkspace()]).catch(() => null);
  return result
    ? <ModulePage config={{ ...moduleConfigs.tasks, rows: result[0].items }} resource="tasks" initialTotal={result[0].total} initialMetrics={result[0].metrics} workspacePanel={<TaskWorkspacePanel initial={result[1]}/>} />
    : <DataLoadError />;
}
