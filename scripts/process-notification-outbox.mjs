import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "EMAIL_DELIVERY_WEBHOOK_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing outbox-worker variables: ${missing.join(", ")}`);

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" };
const heartbeat = createWorkerHeartbeat(baseUrl, serviceKey, "NOTIFICATION_OUTBOX");
const workerId = process.env.WORKER_ID?.trim() || `notification-outbox:${process.pid}:${crypto.randomUUID()}`;

async function rpc(name, body) {
  const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, { method:"POST",headers,body:JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name} failed (${response.status})`);
  return result;
}

try {
  const jobs = await rpc("claim_notification_outbox_leased", {
    batch_size:Number(process.env.OUTBOX_BATCH_SIZE ?? 20),
    worker_id:workerId,
    lease_seconds:300,
  });
  let sent = 0;
  for (const job of jobs) {
    try {
      const identityResponse = await fetch(`${baseUrl}/auth/v1/admin/users/${job.recipient_id}`, { headers });
      const identity = await identityResponse.json();
      if (!identityResponse.ok || !identity.email) throw new Error("Recipient email is unavailable");
      const delivery = await fetch(process.env.EMAIL_DELIVERY_WEBHOOK_URL, {
        method:"POST",
        headers:{ "content-type":"application/json", ...(process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN ? { authorization:`Bearer ${process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN}` } : {}) },
        body:JSON.stringify({ id:job.id,to:identity.email,template:job.template_key,payload:job.payload }),
      });
      if (!delivery.ok) throw new Error(`Delivery webhook returned ${delivery.status}`);
      await rpc("complete_notification_outbox_leased", { job_id:job.id,token:job.lease_token });
      sent += 1;
    } catch (error) {
      await rpc("fail_notification_outbox_leased", { job_id:job.id,token:job.lease_token,failure:error instanceof Error?error.message:"Unknown delivery error" });
    }
  }
  await heartbeat.success({ claimed: jobs.length, delivered: sent });
  process.stdout.write(`Processed ${jobs.length} outbox jobs; ${sent} delivered.\n`);
} catch (error) {
  await heartbeat.failure(error).catch(() => undefined);
  throw error;
}
