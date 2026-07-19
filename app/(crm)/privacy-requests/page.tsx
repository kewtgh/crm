import { DataLoadError } from "@/components/data-state";
import { PrivacyRequestsWorkspace } from "@/components/v200-workspaces";
import { requireUser } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listPrivacyRequests } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.privacyRequests");
export default async function Page() {
  await requireUser();
  const data = await listPrivacyRequests().catch(() => null);
  return data ? <PrivacyRequestsWorkspace initial={data}/> : <DataLoadError/>;
}
