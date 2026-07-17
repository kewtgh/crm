export function createWorkerHeartbeat(baseUrl, serviceKey, worker) {
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "application/json",
  };

  async function record(successful, failure = null, details = {}) {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/record_worker_heartbeat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        worker,
        successful,
        failure: failure ? String(failure).slice(0, 500) : null,
        details,
      }),
    });
    if (!response.ok) throw new Error(`Worker heartbeat failed (${response.status})`);
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
