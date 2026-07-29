import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";
import {
  boundedWorkerInteger,
  mapWithConcurrency,
  workerJobConcurrency,
} from "./lib/bounded-concurrency.mjs";
import { postDeliveryWebhook } from "./lib/delivery-webhook.mjs";
import { workerJson } from "./lib/worker-database.mjs";

const required = ["WORKER_DATABASE_URL", "EMAIL_DELIVERY_WEBHOOK_URL"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing calendar-worker variables: ${missing.join(", ")}`);
const heartbeat = createWorkerHeartbeat("CALENDAR_DELIVERIES");
const workerId = process.env.WORKER_ID?.trim() || `calendar:${process.pid}:${crypto.randomUUID()}`;

async function rpc(name, body) {
  return workerJson(`/db/rpc/${name}`, { method:"POST",body:JSON.stringify(body) });
}

async function row(table, select, id) {
  const rows = await workerJson(`/db/table/${table}?select=${select}&id=eq.${id}&limit=1`);
  if (!rows[0]) throw new Error(`${table} row ${id} is unavailable`);
  return rows[0];
}

try {
  const jobs = await rpc("claim_calendar_deliveries_leased", {
    batch_size:boundedWorkerInteger(process.env.CALENDAR_DELIVERY_BATCH_SIZE, {
      name:"CALENDAR_DELIVERY_BATCH_SIZE",defaultValue:20,maximum:40,
    }),
    worker_id:workerId,
    lease_seconds:300,
  });
  const outcomes = await mapWithConcurrency(jobs, workerJobConcurrency(), async (job) => {
    try {
      const [attendee, appointment] = await Promise.all([
        row("appointment_attendees", "email,name,contact_id", job.attendee_id),
        row("appointments", "title_zh,title_en,starts_at,ends_at,channel,related_label,status", job.appointment_id),
      ]);
      const response = await postDeliveryWebhook({
        endpoint:process.env.EMAIL_DELIVERY_WEBHOOK_URL,
        bearerToken:process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN,
        idempotencyKey:job.idempotency_key,
        payload:{
          id:job.id,
          idempotencyKey:job.idempotency_key,
          to:attendee.email,
          template:`calendar-${job.delivery_type.toLowerCase()}`,
          payload:{eventVersion:job.event_version,attendeeName:attendee.name,appointment},
        },
      });
      if (!response.ok) throw new Error(`Delivery webhook returned ${response.status}`);
      const receipt = await response.json().catch(() => ({}));
      await rpc("complete_calendar_delivery_leased", {
        delivery_id:job.id,
        token:job.lease_token,
        provider_id:String(receipt.id??receipt.messageId??"")||null,
      });
      return true;
    } catch (error) {
      await rpc("fail_calendar_delivery_leased", {
        delivery_id:job.id,
        token:job.lease_token,
        failure:error instanceof Error?error.message:"Unknown calendar delivery error",
      });
      return false;
    }
  });
  const delivered = outcomes.filter(Boolean).length;
  await heartbeat.success({claimed:jobs.length,delivered});
  process.stdout.write(`Processed ${jobs.length} calendar deliveries; ${delivered} delivered.\n`);
} catch (error) {
  await heartbeat.failure(error).catch(() => undefined);
  throw error;
}
