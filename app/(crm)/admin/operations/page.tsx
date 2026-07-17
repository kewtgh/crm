import { OperationsCenterPage } from "@/components/operations-center-page";
import {
  listIntegrations,
  listNextBestActions,
  listRetryableJobs,
  loadBusinessInsights,
  loadOperationalSnapshot,
} from "@/lib/operations-repository";

export default async function Page() {
  const [snapshotResult, jobsResult, integrationsResult, actionsResult, insightsResult] = await Promise.allSettled([
    loadOperationalSnapshot(),
    listRetryableJobs(),
    listIntegrations(),
    listNextBestActions(),
    loadBusinessInsights(),
  ]);
  return <OperationsCenterPage
    initialSnapshot={snapshotResult.status === "fulfilled" ? snapshotResult.value : null}
    initialRetryableJobs={jobsResult.status === "fulfilled" ? jobsResult.value : []}
    initialIntegrations={integrationsResult.status === "fulfilled" ? integrationsResult.value : []}
    initialNextActions={actionsResult.status === "fulfilled" ? actionsResult.value : []}
    initialInsights={insightsResult.status === "fulfilled" ? insightsResult.value : null}
  />;
}
