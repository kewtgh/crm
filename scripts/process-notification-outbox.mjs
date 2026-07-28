import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";
import { workerJson, workerQuery } from "./lib/worker-database.mjs";

const required = ["WORKER_DATABASE_URL", "EMAIL_DELIVERY_WEBHOOK_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing outbox-worker variables: ${missing.join(", ")}`);

const heartbeat = createWorkerHeartbeat("NOTIFICATION_OUTBOX");
const workerId = process.env.WORKER_ID?.trim() || `notification-outbox:${process.pid}:${crypto.randomUUID()}`;

async function rpc(name, body) {
  return workerJson(`/db/rpc/${name}`, { method:"POST",body:JSON.stringify(body) });
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
      const identity = (await workerQuery(
        "select email::text from app_auth.accounts where id=$1 and status='ACTIVE'",
        [job.recipient_id],
      )).rows[0];
      if (!identity?.email) throw new Error("Recipient email is unavailable");
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
