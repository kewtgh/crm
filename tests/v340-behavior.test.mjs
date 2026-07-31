import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  boundedWorkerInteger,
  mapWithConcurrency,
  workerJobConcurrency,
} from "../scripts/lib/bounded-concurrency.mjs";
import {
  deliveryWebhookHeaders,
  postDeliveryWebhook,
} from "../scripts/lib/delivery-webhook.mjs";
import {
  inspectWebReadinessEnvironment,
  inspectWorkerRuntimeEnvironment,
} from "../lib/runtime-environment.ts";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);

const validWorkerEnvironment = {
  NODE_ENV:"production",
  APP_URL:"https://crm.example.net",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY:"turnstile-production-key",
  TURNSTILE_SECRET_KEY:"t".repeat(40),
  TURNSTILE_EXPECTED_HOSTNAME:"crm.example.net",
  ALTCHA_HMAC_SECRET:"a".repeat(40),
  DATABASE_URL:"postgresql://crm_app:app-password@127.0.0.1:5432/lumina_crm",
  SYSTEM_DATABASE_URL:"postgresql://crm_system:system-password@127.0.0.1:5432/lumina_crm",
  WORKER_DATABASE_URL:"postgresql://crm_worker:worker-password@127.0.0.1:5432/lumina_crm",
  CRM_WORKSPACE_ID:"00000000-0000-4000-8000-000000000001",
  OBJECT_STORAGE_PROVIDER:"local",
  OBJECT_STORAGE_LOCAL_ROOT:"/var/lib/lumina-crm/objects",
  LOGIN_THROTTLE_HASH_SECRET:"l".repeat(40),
  TRUSTED_DEVICE_HASH_SECRET:"d".repeat(40),
  TOTP_ENCRYPTION_KEY:"m".repeat(40),
  OBJECT_STORAGE_SIGNING_SECRET:"o".repeat(40),
  EMAIL_DELIVERY_WEBHOOK_URL:"https://mailer.example.net/delivery",
  EMAIL_DELIVERY_WEBHOOK_TOKEN:"e".repeat(40),
  OUTBOX_BATCH_SIZE:"20",
  CALENDAR_DELIVERY_BATCH_SIZE:"20",
  EXPORT_BATCH_SIZE:"10",
  REMINDER_BATCH_SIZE:"100",
  WORKER_JOB_CONCURRENCY:"4",
  WEBHOOKS_ENABLED:"false",
  INTEGRATION_SYNC_ENABLED:"false",
  OBSERVABILITY_ENABLED:"false",
  SSO_ENABLED:"false",
  SCIM_ENABLED:"false",
};

test("runs Worker jobs with a strict concurrency ceiling and stable result order", async () => {
  let active = 0;
  let maximumActive = 0;
  const values = await mapWithConcurrency([1,2,3,4,5,6], 3, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, value % 2 ? 8 : 2));
    active -= 1;
    return value * 10;
  });
  assert.equal(maximumActive, 3);
  assert.deepEqual(values, [10,20,30,40,50,60]);
  assert.equal(workerJobConcurrency({}), 4);
  assert.throws(() => workerJobConcurrency({WORKER_JOB_CONCURRENCY:"9"}), /MUST_BE_BETWEEN_1_AND_8/);
  assert.throws(() => boundedWorkerInteger("NaN", {name:"BATCH",defaultValue:1,maximum:10}), /MUST_BE_BETWEEN/);
});

test("sends a bounded delivery request with a stable provider idempotency key", async () => {
  let captured;
  const response = await postDeliveryWebhook({
    endpoint:"https://mailer.example.net/delivery",
    bearerToken:"secret-token",
    idempotencyKey:"stable-job-id",
    payload:{id:"stable-job-id"},
    timeoutMs:2_000,
    fetchImplementation:async (url, init) => {
      captured = {url,init};
      return new Response(null,{status:202});
    },
  });
  assert.equal(response.status, 202);
  assert.equal(captured.url, "https://mailer.example.net/delivery");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers["idempotency-key"], "stable-job-id");
  assert.equal(captured.init.headers.authorization, "Bearer secret-token");
  assert.equal(captured.init.signal instanceof AbortSignal, true);
  assert.deepEqual(JSON.parse(captured.init.body), {id:"stable-job-id"});
  assert.throws(() => deliveryWebhookHeaders(""), /IDEMPOTENCY_KEY_INVALID/);
  await assert.rejects(
    () => postDeliveryWebhook({endpoint:"https://mailer.example.net",idempotencyKey:"job",payload:{},timeoutMs:999}),
    /DELIVERY_TIMEOUT_INVALID/,
  );
});

test("keeps production Worker tuning inside the reviewed service budget", () => {
  assert.equal(inspectWorkerRuntimeEnvironment(validWorkerEnvironment).valid, true);
  for (const patch of [
    {OUTBOX_BATCH_SIZE:"41"},
    {CALENDAR_DELIVERY_BATCH_SIZE:"41"},
    {EXPORT_BATCH_SIZE:"11"},
    {REMINDER_BATCH_SIZE:"201"},
    {WORKER_JOB_CONCURRENCY:"9"},
    {WORKER_JOB_CONCURRENCY:"1",OUTBOX_BATCH_SIZE:"20"},
  ]) {
    assert.equal(inspectWorkerRuntimeEnvironment({...validWorkerEnvironment,...patch}).valid, false);
  }
  const webhookEnvironment={
    ...validWorkerEnvironment,
    WEBHOOKS_ENABLED:"true",
    WEBHOOK_MICROSOFT_365_SECRET:"1".repeat(40),
    WEBHOOK_GOOGLE_CALENDAR_SECRET:"2".repeat(40),
    WEBHOOK_EMAIL_SECRET:"3".repeat(40),
    WEBHOOK_E_SIGNATURE_SECRET:"4".repeat(40),
    WEBHOOK_ACCOUNTING_SECRET:"5".repeat(40),
    WEBHOOK_PAYMENT_SECRET:"6".repeat(40),
    WEBHOOK_PROCESSOR_URL:"https://processor.example.net/events",
    WEBHOOK_PROCESSOR_TOKEN:"7".repeat(40),
    WEBHOOK_BATCH_SIZE:"41",
  };
  assert.equal(inspectWorkerRuntimeEnvironment(webhookEnvironment).valid, false);
  const integrationEnvironment={
    ...validWorkerEnvironment,
    INTEGRATION_SYNC_ENABLED:"true",
    INTEGRATION_SYNC_PROCESSOR_URL:"https://processor.example.net/sync",
    INTEGRATION_SYNC_PROCESSOR_TOKEN:"8".repeat(40),
    INTEGRATION_SYNC_BATCH_SIZE:"10",
  };
  assert.equal(inspectWorkerRuntimeEnvironment(integrationEnvironment).valid, true);
  assert.equal(inspectWorkerRuntimeEnvironment({...integrationEnvironment,WORKER_JOB_CONCURRENCY:"2"}).valid, false);
});

test("reports Web email delivery configuration without probing or exposing it", () => {
  const configured = inspectWebReadinessEnvironment(validWorkerEnvironment);
  assert.equal(configured.valid, true);
  assert.equal(configured.emailDeliveryConfigured, true);
  assert.equal(configured.emailDeliveryExternallyHealthy, null);
  assert.equal(configured.emailDeliveryCode, null);
  const serialized = JSON.stringify(configured);
  assert.doesNotMatch(serialized, /mailer\.example\.net|e{40}/);

  for (const missingKey of ["EMAIL_DELIVERY_WEBHOOK_URL", "EMAIL_DELIVERY_WEBHOOK_TOKEN"]) {
    const environment = { ...validWorkerEnvironment };
    delete environment[missingKey];
    const missing = inspectWebReadinessEnvironment(environment);
    assert.equal(missing.valid, false);
    assert.equal(missing.core, true);
    assert.equal(missing.emailDeliveryConfigured, false);
    assert.equal(missing.emailDeliveryExternallyHealthy, null);
    assert.equal(missing.emailDeliveryCode, "EMAIL_DELIVERY_NOT_CONFIGURED");
    assert.ok(missing.missing.includes(missingKey));
  }
});

test("parallelizes independent Worker categories without weakening per-job leases", async () => {
  const [cycle,outbox,calendar,webhook,integration] = await Promise.all([
    readFile(repositoryFile("scripts/process-worker-cycle.mjs"),"utf8"),
    readFile(repositoryFile("scripts/process-notification-outbox.mjs"),"utf8"),
    readFile(repositoryFile("scripts/process-calendar-deliveries.mjs"),"utf8"),
    readFile(repositoryFile("scripts/process-webhook-inbox.mjs"),"utf8"),
    readFile(repositoryFile("scripts/process-integration-sync.mjs"),"utf8"),
  ]);
  assert.match(cycle, /Promise\.all\(workers\.map/);
  assert.match(cycle, /createWorkerHeartbeat\(worker\)/);
  for (const source of [outbox,calendar,webhook,integration]) {
    assert.match(source, /mapWithConcurrency/);
  }
  assert.match(outbox, /idempotencyKey:job\.id/);
  assert.match(calendar, /idempotencyKey:job\.idempotency_key/);
  assert.match(outbox, /complete_notification_outbox_leased/);
  assert.match(calendar, /complete_calendar_delivery_leased/);
});

test("localizes critical loading and protects uncertain staff creation", async () => {
  const [loading,globalError,staff] = await Promise.all([
    readFile(repositoryFile("app/(crm)/loading.tsx"),"utf8"),
    readFile(repositoryFile("app/global-error.tsx"),"utf8"),
    readFile(repositoryFile("components/staff-users-page.tsx"),"utf8"),
  ]);
  assert.match(loading, /useI18n/);
  assert.match(loading, /t\("common\.loading"\)/);
  assert.match(globalError, /lang="en"/);
  assert.match(globalError, /temporarily unavailable/);
  assert.match(staff, /onCancel=\{\(event\)=>\{if\(pending\)event\.preventDefault\(\);\}\}/);
  assert.match(staff, /onChange=\{clearEditedFieldError\}/);
  assert.match(staff, /disabled=\{pending\} aria-label=\{t\("common\.close"\)\}/);
});
