import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";
import { workerJson } from "./lib/worker-database.mjs";

const required = [
  "WORKER_DATABASE_URL",
  "INTEGRATION_SYNC_PROCESSOR_URL",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing integration-sync variables: ${missing.join(", ")}`);
const workerId = process.env.WORKER_ID?.trim() || `integration-sync:${process.pid}:${crypto.randomUUID()}`;
const heartbeat = createWorkerHeartbeat("INTEGRATION_SYNC");

async function rpc(name, body) {
  return workerJson(`/db/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

try {
  const jobs = await rpc("claim_integration_sync_jobs", {
    batch_size: Number(process.env.INTEGRATION_SYNC_BATCH_SIZE ?? 10),
    worker_id: workerId,
    lease_seconds: 900,
  });
  let completed = 0;
  for (const job of jobs) {
    try {
      const validations = await workerJson(`/db/table/connector_validation_receipts?select=id&workspace_id=eq.${job.workspace_id}&provider=eq.${job.provider}&status=eq.SUCCEEDED&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=validated_at.desc&limit=1`);
      if (!validations.length) throw new Error("CONNECTOR_VALIDATION_REQUIRED");
      const response = await fetch(process.env.INTEGRATION_SYNC_PROCESSOR_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.INTEGRATION_SYNC_PROCESSOR_TOKEN
            ? { authorization: `Bearer ${process.env.INTEGRATION_SYNC_PROCESSOR_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          id: job.id,
          provider: job.provider,
          direction: job.sync_direction,
          cursor: job.cursor_before,
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Integration processor returned ${response.status}`);
      const receipt = await response.json().catch(() => ({}));
      await rpc("complete_integration_sync_job", {
        job_id: job.id,
        token: job.lease_token,
        next_cursor: String(receipt.nextCursor ?? job.cursor_before ?? ""),
      });
      completed += 1;
    } catch (error) {
      await rpc("fail_integration_sync_job", {
        job_id: job.id,
        token: job.lease_token,
        failure: error instanceof Error ? error.message : "Unknown integration sync error",
      });
    }
  }
  await heartbeat.success({ claimed: jobs.length, completed });
  process.stdout.write(`Processed ${jobs.length} integration sync jobs; ${completed} completed.\n`);
} catch (error) {
  await heartbeat.failure(error).catch(() => undefined);
  throw error;
}
