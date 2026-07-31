import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  classifyProviderResponse,
  communicationDeliveryBatchSize,
  processCommunicationDeliveries,
} from "../scripts/process-communication-deliveries.mjs";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);
const messageId = "00000000-0000-4000-8000-000000000111";
const leaseToken = "00000000-0000-4000-8000-000000000222";
const environment = {
  WORKER_DATABASE_URL: "postgresql://crm_worker:test@postgres:5432/lumina_crm",
  CRM_WORKSPACE_ID: "00000000-0000-4000-8000-000000000001",
  EMAIL_DELIVERY_WEBHOOK_URL: "https://mailer.example.test/delivery",
  EMAIL_DELIVERY_WEBHOOK_TOKEN: "token-that-must-never-be-logged",
  WORKER_ID: "test-worker",
  WORKER_JOB_CONCURRENCY: "2",
  COMMUNICATION_DELIVERY_BATCH_SIZE: "40",
};
const claimedJob = {
  message_id: messageId,
  thread_id: "00000000-0000-4000-8000-000000000333",
  recipient_email: "recipient@example.test",
  subject: "Subject",
  body: "Body",
  recipient_display_name: "Recipient",
  consent_purpose: "SERVICE",
  lease_token: leaseToken,
};

function rpcHarness({ completionFailures = 0, failureResult = "FAILED" } = {}) {
  const calls = [];
  let remainingCompletionFailures = completionFailures;
  return {
    calls,
    rpc: async (name, body) => {
      calls.push({ name, body });
      if (name === "claim_communication_deliveries_leased") return [claimedJob];
      if (name === "complete_communication_delivery_leased"
        && remainingCompletionFailures > 0) {
        remainingCompletionFailures -= 1;
        throw new Error("database unavailable");
      }
      if (name === "fail_communication_delivery_leased") return failureResult;
      return undefined;
    },
  };
}

test("switch migration makes durable queueing the atomic delivery boundary", async () => {
  const [migration, route, repository] = await Promise.all([
    readFile(repositoryFile("db/migrations/202607310071_async_communication_delivery_switch.sql"), "utf8"),
    readFile(repositoryFile("app/api/communications/route.ts"), "utf8"),
    readFile(repositoryFile("lib/v220-repository.ts"), "utf8"),
  ]);
  assert.match(migration, /next_attempt_at=now\(\)/);
  assert.match(migration, /'shouldDeliver',true/);
  assert.doesNotMatch(route, /shouldDeliver/);
  assert.match(migration, /'accepted',result\.delivery_status='QUEUED'/);
  assert.match(route, /status:deliveryStatus==="QUEUED"\?202:200/);
  assert.match(route, /status:202/);
  assert.match(route, /requeueCommunicationMessage/);
  assert.doesNotMatch(route, /fetch\(|EMAIL_DELIVERY_WEBHOOK|communicationRecipient|completeCommunication|failCommunication/);
  assert.doesNotMatch(repository, /service_complete_communication|service_fail_communication|retry_communication_message/);
});

test("communication delivery batch obeys concurrency, timeout budget and hard maximum", () => {
  assert.equal(communicationDeliveryBatchSize(environment), 18);
  assert.equal(communicationDeliveryBatchSize({
    ...environment,
    WORKER_JOB_CONCURRENCY: "4",
    COMMUNICATION_DELIVERY_BATCH_SIZE: "20",
  }), 20);
  assert.throws(
    () => communicationDeliveryBatchSize({
      ...environment,
      COMMUNICATION_DELIVERY_BATCH_SIZE: "41",
    }),
    /MUST_BE_BETWEEN_1_AND_40/,
  );
});

test("Worker marks attempt before fetch and completes with the durable message id", async () => {
  const harness = rpcHarness();
  let fetchCalls = 0;
  let request;
  const result = await processCommunicationDeliveries({
    environment,
    rpc: harness.rpc,
    fetchImplementation: async (url, init) => {
      fetchCalls += 1;
      request = { url, init };
      return new Response(JSON.stringify({ id: "provider-message-id" }), {
        status: 200,
      });
    },
  });
  assert.equal(fetchCalls, 1);
  assert.equal(request.init.headers["idempotency-key"], messageId);
  assert.equal(JSON.parse(request.init.body).template, "communication-message");
  assert.equal(harness.calls[0].name, "claim_communication_deliveries_leased");
  assert.equal(harness.calls[1].name, "mark_communication_delivery_attempt_started_leased");
  assert.equal(harness.calls[2].name, "complete_communication_delivery_leased");
  assert.equal(harness.calls[2].body.provider_id, "provider-message-id");
  assert.equal(result.sent, 1);
});

test("stable provider errors map to governed fenced failure outcomes", async () => {
  assert.deepEqual(
    classifyProviderResponse(
      new Response("", { status: 502 }),
      { error: { code: "PROVIDER_REJECTED" } },
    ),
    { kind: "failure", code: "PROVIDER_REJECTED", outcome: "DEFINITE_PERMANENT" },
  );
  assert.deepEqual(
    classifyProviderResponse(
      new Response("", { status: 503 }),
      { error: { code: "PROVIDER_UNAVAILABLE" } },
    ),
    { kind: "failure", code: "PROVIDER_UNAVAILABLE", outcome: "DEFINITE_RETRYABLE" },
  );
  assert.deepEqual(
    classifyProviderResponse(new Response("{}", { status: 200 }), {}),
    { kind: "failure", code: "PROVIDER_INVALID_RESPONSE", outcome: "POSSIBLY_ACCEPTED" },
  );
});

test("timeout after attempt-start preserves possible acceptance", async () => {
  const harness = rpcHarness({ failureResult: "QUEUED" });
  await processCommunicationDeliveries({
    environment,
    rpc: harness.rpc,
    fetchImplementation: async () => {
      throw new Error("endpoint and recipient must not escape");
    },
  });
  const failure = harness.calls.find(
    (call) => call.name === "fail_communication_delivery_leased",
  );
  assert.equal(failure.body.failure_code, "PROVIDER_UNAVAILABLE");
  assert.equal(failure.body.outcome_class, "POSSIBLY_ACCEPTED");
});

test("provider success plus completion retry never repeats provider I/O", async () => {
  const recovered = rpcHarness({ completionFailures: 2 });
  let recoveredFetches = 0;
  await processCommunicationDeliveries({
    environment,
    rpc: recovered.rpc,
    fetchImplementation: async () => {
      recoveredFetches += 1;
      return new Response(JSON.stringify({ id: "provider-message-id" }));
    },
  });
  assert.equal(recoveredFetches, 1);
  assert.equal(
    recovered.calls.filter(
      (call) => call.name === "complete_communication_delivery_leased",
    ).length,
    3,
  );

  const unresolved = rpcHarness({ completionFailures: 3 });
  let unresolvedFetches = 0;
  await assert.rejects(
    () => processCommunicationDeliveries({
      environment,
      rpc: unresolved.rpc,
      fetchImplementation: async () => {
        unresolvedFetches += 1;
        return new Response(JSON.stringify({ id: "provider-message-id" }));
      },
    }),
    /COMMUNICATION_COMPLETION_NOT_RECORDED/,
  );
  assert.equal(unresolvedFetches, 1);
  assert.equal(
    unresolved.calls.some(
      (call) => call.name === "fail_communication_delivery_leased",
    ),
    false,
  );
});

test("claim-time recipient or consent rejection cannot call the provider", async () => {
  let fetchCalls = 0;
  const result = await processCommunicationDeliveries({
    environment,
    rpc: async (name) => name === "claim_communication_deliveries_leased"
      ? [] : undefined,
    fetchImplementation: async () => {
      fetchCalls += 1;
      return new Response();
    },
  });
  assert.equal(result.claimed, 0);
  assert.equal(fetchCalls, 0);
});

test("Worker, readiness, Operations and UI expose the asynchronous contract safely", async () => {
  const [cycle, healthcheck, runtime, migration, operationTypes, health, component, locale, dockerfile] = await Promise.all([
    readFile(repositoryFile("scripts/process-worker-cycle.mjs"), "utf8"),
    readFile(repositoryFile("scripts/worker-healthcheck.mjs"), "utf8"),
    readFile(repositoryFile("lib/runtime-environment.ts"), "utf8"),
    readFile(repositoryFile("db/migrations/202607310071_async_communication_delivery_switch.sql"), "utf8"),
    readFile(repositoryFile("lib/operations-types.ts"), "utf8"),
    readFile(repositoryFile("app/api/health/route.ts"), "utf8"),
    readFile(repositoryFile("components/communications-inbox-page.tsx"), "utf8"),
    readFile(repositoryFile("lib/i18n/locales/v220.ts"), "utf8"),
    readFile(repositoryFile("Dockerfile"), "utf8"),
  ]);
  for (const source of [cycle, healthcheck, runtime, migration, operationTypes]) {
    assert.match(source, /COMMUNICATION_DELIVERY/);
  }
  assert.match(migration, /queued.*processing.*expiredLeases.*failed.*uncertain.*slaBreaches.*oldestDueAt/s);
  assert.match(health, /configurationBoundary:"worker"/);
  assert.doesNotMatch(health.slice(0, health.indexOf("async function get")), /EMAIL_DELIVERY_WEBHOOK/);
  assert.match(component, /message\.retryAllowed/);
  assert.doesNotMatch(component, /message\.lastError/);
  assert.match(locale, /消息已加入投递队列/);
  assert.match(locale, /消息已重新加入投递队列/);
  assert.match(component, /\["QUEUED","PROCESSING"\]/);
  assert.match(dockerfile, /scripts\/process-communication-deliveries\.mjs/);
  assert.match(dockerfile, /lib\/email-delivery-runtime\.mjs/);
});

test("processor source and results never log delivery secrets or message content", async () => {
  const source = await readFile(
    repositoryFile("scripts/process-communication-deliveries.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /console\.(?:log|error)|JSON\.stringify\(job\)/);
  const harness = rpcHarness();
  const result = await processCommunicationDeliveries({
    environment,
    rpc: harness.rpc,
    fetchImplementation: async () => new Response(
      JSON.stringify({ error: { code: "PROVIDER_REJECTED" } }),
      { status: 502 },
    ),
  });
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    environment.EMAIL_DELIVERY_WEBHOOK_URL,
    environment.EMAIL_DELIVERY_WEBHOOK_TOKEN,
    claimedJob.recipient_email,
    claimedJob.subject,
    claimedJob.body,
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
