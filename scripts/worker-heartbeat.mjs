import { workerJson } from "./lib/worker-database.mjs";

export function createWorkerHeartbeat(worker) {
  async function record(successful, failure = null, details = {}) {
    await workerJson("/db/rpc/record_worker_heartbeat", {
      method: "POST",
      body: JSON.stringify({
        worker,
        successful,
        failure: failure ? String(failure).slice(0, 500) : null,
        details,
      }),
    });
  }

  return {
    success: (details = {}) => record(true, null, details),
    failure: (error, details = {}) => record(
      false,
      error instanceof Error ? error.message : String(error ?? "UNKNOWN"),
      details,
    ),
  };
}
