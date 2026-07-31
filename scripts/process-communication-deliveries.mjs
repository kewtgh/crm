import { pathToFileURL } from "node:url";
import {
  boundedWorkerInteger,
  mapWithConcurrency,
  workerJobConcurrency,
} from "./lib/bounded-concurrency.mjs";
import {
  DELIVERY_WEBHOOK_TIMEOUT_MS,
  postDeliveryWebhook,
} from "./lib/delivery-webhook.mjs";

export const COMMUNICATION_DELIVERY_EXTERNAL_BUDGET_SECONDS = 180;
export const COMMUNICATION_DELIVERY_MAX_BATCH_SIZE = 40;
export const COMMUNICATION_DELIVERY_LEASE_SECONDS = 300;

const permanentConfigurationCodes = new Set([
  "UNAUTHORIZED",
  "SERVICE_NOT_CONFIGURED",
  "DELIVERY_CONFIGURATION_UNAVAILABLE",
]);

export function communicationDeliveryBatchSize(environment = process.env) {
  const concurrency = workerJobConcurrency(environment);
  const configured = boundedWorkerInteger(
    environment.COMMUNICATION_DELIVERY_BATCH_SIZE,
    {
      name: "COMMUNICATION_DELIVERY_BATCH_SIZE",
      defaultValue: 20,
      maximum: COMMUNICATION_DELIVERY_MAX_BATCH_SIZE,
    },
  );
  const budgetMaximum = concurrency * Math.floor(
    COMMUNICATION_DELIVERY_EXTERNAL_BUDGET_SECONDS
      / (DELIVERY_WEBHOOK_TIMEOUT_MS / 1_000),
  );
  return Math.min(configured, budgetMaximum, COMMUNICATION_DELIVERY_MAX_BATCH_SIZE);
}

function requiredEnvironment(environment) {
  const required = [
    "WORKER_DATABASE_URL",
    "CRM_WORKSPACE_ID",
    "EMAIL_DELIVERY_WEBHOOK_URL",
    "EMAIL_DELIVERY_WEBHOOK_TOKEN",
  ];
  if (required.some((key) => !environment[key]?.trim())) {
    throw new Error("COMMUNICATION_DELIVERY_NOT_CONFIGURED");
  }
}

async function responseBody(response) {
  let text;
  try {
    text = await response.text();
  } catch {
    return null;
  }
  if (text.length > 8_192) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function providerReceipt(body) {
  const id = typeof body?.id === "string"
    ? body.id.trim()
    : typeof body?.messageId === "string"
      ? body.messageId.trim()
      : "";
  return id.length >= 1 && id.length <= 240 && !/[\r\n]/.test(id) ? id : null;
}

export function classifyProviderResponse(response, body) {
  if (response.ok) {
    const providerId = providerReceipt(body);
    return providerId
      ? { kind: "success", providerId }
      : {
          kind: "failure",
          code: "PROVIDER_INVALID_RESPONSE",
          outcome: "POSSIBLY_ACCEPTED",
        };
  }
  const remoteCode = typeof body?.error?.code === "string"
    ? body.error.code.trim().toUpperCase()
    : "";
  if (remoteCode === "PROVIDER_REJECTED") {
    return {
      kind: "failure",
      code: "PROVIDER_REJECTED",
      outcome: "DEFINITE_PERMANENT",
    };
  }
  if (permanentConfigurationCodes.has(remoteCode)
    || response.status === 401 || response.status === 403) {
    return {
      kind: "failure",
      code: "DELIVERY_CONFIGURATION_UNAVAILABLE",
      outcome: "DEFINITE_PERMANENT",
    };
  }
  if (remoteCode === "PROVIDER_INVALID_RESPONSE") {
    return {
      kind: "failure",
      code: "PROVIDER_INVALID_RESPONSE",
      outcome: "POSSIBLY_ACCEPTED",
    };
  }
  if (remoteCode === "PROVIDER_UNAVAILABLE") {
    return {
      kind: "failure",
      code: "PROVIDER_UNAVAILABLE",
      outcome: "DEFINITE_RETRYABLE",
    };
  }
  return {
    kind: "failure",
    code: "PROVIDER_INVALID_RESPONSE",
    outcome: "POSSIBLY_ACCEPTED",
  };
}

async function completeWithoutResending(rpc, messageId, workerId, token, providerId) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rpc("complete_communication_delivery_leased", {
        target_message: messageId,
        worker_id: workerId,
        token,
        provider_id: providerId,
      });
      return;
    } catch {
      // The same fenced completion is repeat-safe. Never repeat provider I/O.
    }
  }
  throw new Error("COMMUNICATION_COMPLETION_NOT_RECORDED");
}

export async function processCommunicationDeliveries({
  environment = process.env,
  fetchImplementation = globalThis.fetch,
  rpc,
}) {
  requiredEnvironment(environment);
  const concurrency = workerJobConcurrency(environment);
  const batchSize = communicationDeliveryBatchSize(environment);
  const workerId = environment.WORKER_ID?.trim()
    ? `communication-delivery:${environment.WORKER_ID.trim()}`
    : `communication-delivery:${process.pid}:${crypto.randomUUID()}`;
  const jobs = await rpc("claim_communication_deliveries_leased", {
    target_workspace: environment.CRM_WORKSPACE_ID,
    batch_size: batchSize,
    worker_id: workerId,
    lease_seconds: COMMUNICATION_DELIVERY_LEASE_SECONDS,
  });
  const outcomes = await mapWithConcurrency(jobs, concurrency, async (job) => {
    try {
      await rpc("mark_communication_delivery_attempt_started_leased", {
        target_message: job.message_id,
        worker_id: workerId,
        token: job.lease_token,
      });
    } catch {
      throw new Error("COMMUNICATION_ATTEMPT_START_FAILED");
    }

    let classification;
    try {
      const response = await postDeliveryWebhook({
        endpoint: environment.EMAIL_DELIVERY_WEBHOOK_URL,
        bearerToken: environment.EMAIL_DELIVERY_WEBHOOK_TOKEN,
        idempotencyKey: job.message_id,
        payload: {
          id: job.message_id,
          to: job.recipient_email,
          template: "communication-message",
          payload: {
            subject: job.subject,
            body: job.body,
            recipientName: job.recipient_display_name,
          },
        },
        fetchImplementation,
      });
      classification = classifyProviderResponse(
        response,
        await responseBody(response),
      );
    } catch {
      classification = {
        kind: "failure",
        code: "PROVIDER_UNAVAILABLE",
        outcome: "POSSIBLY_ACCEPTED",
      };
    }

    if (classification.kind === "success") {
      await completeWithoutResending(
        rpc,
        job.message_id,
        workerId,
        job.lease_token,
        classification.providerId,
      );
      return "SENT";
    }
    try {
      return await rpc("fail_communication_delivery_leased", {
        target_message: job.message_id,
        worker_id: workerId,
        token: job.lease_token,
        failure_code: classification.code,
        outcome_class: classification.outcome,
      });
    } catch {
      throw new Error("COMMUNICATION_FAILURE_NOT_RECORDED");
    }
  });
  return {
    claimed: jobs.length,
    sent: outcomes.filter((outcome) => outcome === "SENT").length,
    queued: outcomes.filter((outcome) => outcome === "QUEUED").length,
    failed: outcomes.filter((outcome) => outcome === "FAILED").length,
    uncertain: outcomes.filter((outcome) => outcome === "UNCERTAIN").length,
    batchSize,
    concurrency,
  };
}

async function main() {
  const { createWorkerHeartbeat } = await import("./worker-heartbeat.mjs");
  const { closeWorkerDatabase, workerJson } = await import(
    "./lib/worker-database.mjs"
  );
  const heartbeat = createWorkerHeartbeat("COMMUNICATION_DELIVERY");
  const rpc = (name, body) => workerJson(`/db/rpc/${name}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  try {
    const result = await processCommunicationDeliveries({ rpc });
    await heartbeat.success(result);
    process.stdout.write(
      `Processed ${result.claimed} communication deliveries; `
      + `${result.sent} provider receipts recorded.\n`,
    );
  } catch {
    const failure = new Error("COMMUNICATION_DELIVERY_WORKER_FAILED");
    await heartbeat.failure(failure).catch(() => undefined);
    throw failure;
  } finally {
    await closeWorkerDatabase().catch(() => undefined);
  }
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
