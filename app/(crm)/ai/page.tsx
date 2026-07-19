import { DataLoadError } from "@/components/data-state";
import { SuggestionsWorkspace } from "@/components/v200-workspaces";
import { requireCapability } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";
import { listSuggestions } from "@/lib/v200-repository";

export const generateMetadata = () => localizedPageMetadata("meta.ai");
export default async function Page() {
  await requireCapability("ai.review");
  const data = await listSuggestions({status:"OPEN"}).catch(() => null);
  return data ? <SuggestionsWorkspace initial={data}/> : <DataLoadError/>;
}
