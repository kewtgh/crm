import { OperationsCenterPage } from "@/components/operations-center-page";
import {
  listIntegrations,
  listNextBestActions,
  listRetryableJobs,
  loadBusinessInsights,
  loadOperationalSnapshot,
  loadReleaseReadiness,
} from "@/lib/operations-repository";

export default async function Page() {
  const [snapshotResult, jobsResult, integrationsResult, actionsResult, insightsResult,readinessResult] = await Promise.allSettled([
    loadOperationalSnapshot(),
    listRetryableJobs(),
    listIntegrations(),
    listNextBestActions(),
    loadBusinessInsights(),
    loadReleaseReadiness(),
  ]);
  return <OperationsCenterPage
    initialSnapshot={snapshotResult.status === "fulfilled" ? snapshotResult.value : null}
    initialRetryableJobs={jobsResult.status === "fulfilled" ? jobsResult.value : {items:[],total:0,page:1,pageSize:10}}
    initialIntegrations={integrationsResult.status === "fulfilled" ? integrationsResult.value : []}
    initialNextActions={actionsResult.status === "fulfilled" ? actionsResult.value : {items:[],total:0,page:1,pageSize:10}}
    initialInsights={insightsResult.status === "fulfilled" ? insightsResult.value : null}
    initialReadiness={readinessResult.status === "fulfilled" ? readinessResult.value : null}
  />;
}
