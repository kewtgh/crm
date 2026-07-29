import { DataLoadError } from "@/components/data-state";
import { WorkspaceSettingsPage } from "@/components/workspace-settings-page";
import { requireRole } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { loadWorkspaceSettings } from "@/lib/workspace-settings-repository";

export const generateMetadata = () => localizedPageMetadata("meta.workspaceSettings");

export default async function Page() {
  const user = await requireRole("SUPER_ADMIN", "ADMIN");
  const settings = await loadWorkspaceSettings(user).catch(() => null);
  return settings
    ? <WorkspaceSettingsPage initial={settings}/>
    : <DataLoadError detailKey="workspaceSettings.loadFailed"/>;
}
