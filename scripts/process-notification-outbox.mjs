import { createWorkerHeartbeat } from "./worker-heartbeat.mjs";
import {
  boundedWorkerInteger,
  mapWithConcurrency,
  workerJobConcurrency,
} from "./lib/bounded-concurrency.mjs";
import { postDeliveryWebhook } from "./lib/delivery-webhook.mjs";
import { workerJson, workerQuery } from "./lib/worker-database.mjs";
import { decryptInvitationCredential } from "../lib/invitation-credential-crypto.mjs";

const required = ["WORKER_DATABASE_URL", "EMAIL_DELIVERY_WEBHOOK_URL", "INVITATION_CREDENTIAL_ENCRYPTION_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing outbox-worker variables: ${missing.join(", ")}`);

const heartbeat = createWorkerHeartbeat("NOTIFICATION_OUTBOX");
const workerId = process.env.WORKER_ID?.trim() || `notification-outbox:${process.pid}:${crypto.randomUUID()}`;

async function rpc(name, body) {
  return workerJson(`/db/rpc/${name}`, { method:"POST",body:JSON.stringify(body) });
}

function deliveryFailure(error) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return { status:"UNCERTAIN",code:"DELIVERY_TIMEOUT",httpStatus:null };
  }
  if (error instanceof TypeError) {
    return { status:"UNCERTAIN",code:"DELIVERY_NETWORK_ERROR",httpStatus:null };
  }
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.message)
    ? error.message
    : "DELIVERY_FAILED";
  return { status:"FAILED",code,httpStatus:null };
}

try {
  const jobs = await rpc("claim_notification_outbox_leased", {
    batch_size:boundedWorkerInteger(process.env.OUTBOX_BATCH_SIZE, {
      name:"OUTBOX_BATCH_SIZE",defaultValue:20,maximum:40,
    }),
    worker_id:workerId,
    lease_seconds:300,
  });
  const outcomes = await mapWithConcurrency(jobs, workerJobConcurrency(), async (job) => {
    const invitationDeliveryId = job.template_key === "staff-account-created"
      ? job.payload?.invitationDeliveryId
      : null;
    try {
      const identity = (await workerQuery(
        "select email::text from app_auth.accounts where id=$1 and status='ACTIVE'",
        [job.recipient_id],
      )).rows[0];
      if (!identity?.email) throw new Error("Recipient email is unavailable");
      const payload = invitationDeliveryId ? {
        ...job.payload,
        encryptedTemporaryPassword:undefined,
        temporaryPassword:decryptInvitationCredential(job.payload?.encryptedTemporaryPassword),
      } : job.payload;
      const delivery = await postDeliveryWebhook({
        endpoint:process.env.EMAIL_DELIVERY_WEBHOOK_URL,
        bearerToken:process.env.EMAIL_DELIVERY_WEBHOOK_TOKEN,
        idempotencyKey:job.id,
        payload:{ id:job.id,to:identity.email,template:job.template_key,payload },
      });
      if (!delivery.ok) {
        if (invitationDeliveryId) await rpc("record_staff_invitation_delivery", {
          delivery_id:invitationDeliveryId,delivery_status:"FAILED",
          failure:`DELIVERY_HTTP_${delivery.status}`,http_status:delivery.status,
        });
        throw new Error(`DELIVERY_HTTP_${delivery.status}`);
      }
      if (invitationDeliveryId) await rpc("record_staff_invitation_delivery", {
        delivery_id:invitationDeliveryId,delivery_status:"SENT",failure:null,http_status:delivery.status,
      });
      await rpc("complete_notification_outbox_leased", { job_id:job.id,token:job.lease_token });
      return true;
    } catch (error) {
      const failure = deliveryFailure(error);
      if (invitationDeliveryId && !String(failure.code).startsWith("DELIVERY_HTTP_")) {
        await rpc("record_staff_invitation_delivery", {
          delivery_id:invitationDeliveryId,delivery_status:failure.status,
          failure:failure.code,http_status:failure.httpStatus,
        }).catch(() => undefined);
      }
      process.stderr.write(`[notification-outbox] delivery failed code=${failure.code} httpStatus=${failure.httpStatus??"none"}\n`);
      await rpc("fail_notification_outbox_leased", { job_id:job.id,token:job.lease_token,failure:failure.code });
      return false;
    }
  });
  const sent = outcomes.filter(Boolean).length;
  await heartbeat.success({ claimed: jobs.length, delivered: sent });
  process.stdout.write(`Processed ${jobs.length} outbox jobs; ${sent} delivered.\n`);
} catch (error) {
  await heartbeat.failure(error).catch(() => undefined);
  throw error;
}
