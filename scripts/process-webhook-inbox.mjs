import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "WEBHOOK_PROCESSOR_URL",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing webhook-worker variables: ${missing.join(", ")}`);
const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  "content-type": "application/json",
};
const heartbeat = createWorkerHeartbeat(baseUrl, serviceKey, "WEBHOOK_INBOX");
const workerId = process.env.WORKER_ID ?? `webhook-inbox:${process.pid}:${crypto.randomUUID()}`;

async function rpc(name, body) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name} failed (${response.status})`);
  return result;
}

try {
  const events = await rpc("claim_webhook_events_leased", {
    batch_size: Number(process.env.WEBHOOK_BATCH_SIZE ?? 20),
    worker_id: workerId,
    lease_seconds: 300,
  });
  let processed = 0;
  for (const event of events) {
    try {
      const response = await fetch(process.env.WEBHOOK_PROCESSOR_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(process.env.WEBHOOK_PROCESSOR_TOKEN
            ? { authorization: `Bearer ${process.env.WEBHOOK_PROCESSOR_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({
          id: event.id,
          provider: event.provider,
          eventId: event.event_id,
          eventType: event.event_type,
          payload: event.payload,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Webhook processor returned ${response.status}`);
      await rpc("complete_webhook_event_leased", {
        target_event: event.id,
        token: event.lease_token,
      });
      processed += 1;
    } catch (error) {
      await rpc("fail_webhook_event_leased", {
        target_event: event.id,
        token: event.lease_token,
        failure: error instanceof Error ? error.message : "Unknown webhook processing error",
      });
    }
  }
  await heartbeat.success({ claimed: events.length, processed });
  process.stdout.write(`Processed ${events.length} webhook events; ${processed} completed.\n`);
} catch (error) {
  await heartbeat.failure(error).catch(() => undefined);
  throw error;
}
