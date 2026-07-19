import { DataLoadError } from "@/components/data-state";
import { StudentsWorkspace } from "@/components/v200-workspaces";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listStudents } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.students");
export default async function Page() {
  await requireCapability("education.view");
  const data = await listStudents().catch(() => null);
  return data ? <StudentsWorkspace initial={data}/> : <DataLoadError/>;
}
