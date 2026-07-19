import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INTEGRATION_SYNC_PROCESSOR_URL",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing integration-sync variables: ${missing.join(", ")}`);
const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  "content-type": "application/json",
};
const workerId = process.env.WORKER_ID?.trim() || `integration-sync:${process.pid}:${crypto.randomUUID()}`;
const heartbeat = createWorkerHeartbeat(baseUrl, serviceKey, "INTEGRATION_SYNC");

async function rpc(name, body) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name} failed (${response.status})`);
  return result;
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
