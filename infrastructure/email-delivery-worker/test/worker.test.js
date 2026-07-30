import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createEmailDeliveryWorker,
} from "../src/index.js";
import {
  TEMPLATE_KEYS,
} from "../src/templates.js";

const CRM_TOKEN = "unit-test-crm-delivery-token";
const RESEND_KEY = "unit-test-resend-api-key";
const RECIPIENT = "recipient@example.test";
const APPLICATION_URL = "https://crm.example.test";
const DELIVERY_PATH = "/test-delivery";
const HEALTH_PATH = "/test-health";
const workerRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = path.resolve(workerRoot, "..", "..");

function environment(overrides = {}) {
  return {
    LUMINA_WEBHOOK_TOKEN: CRM_TOKEN,
    RESEND_API_KEY: RESEND_KEY,
    EMAIL_FROM: "Lumina Test <sender@example.test>",
    CRM_APP_URL: APPLICATION_URL,
    EMAIL_BRAND_NAME: "Lumina Education CRM",
    DELIVERY_PATH,
    HEALTH_PATH,
    ...overrides,
  };
}

function samplePayloads() {
  const appointment = {
    title_zh: "升学咨询",
    title_en: "Education consultation",
    starts_at: "2026-08-01T02:00:00.000Z",
    ends_at: "2026-08-01T03:00:00.000Z",
    channel: "Video",
    related_label: "Example School",
    status: "SCHEDULED",
  };
  return {
    reminder: {
      reminderId: "reminder-123",
      locale: "en",
      timezone: "Asia/Taipei",
    },
    "password-reset": {
      url: `${APPLICATION_URL}/reset-password?token=unit-test-reset-token`,
      expiresInSeconds: 1_800,
    },
    "device-verification": {
      code: "123456",
      expiresInSeconds: 600,
    },
    "email-verification": {
      url: `${APPLICATION_URL}/api/auth/email-verification?token=unit-test-email-token`,
      expiresInSeconds: 86_400,
    },
    "staff-account-created": {
      username: "unit.test",
      temporaryPassword: "unit-test-temporary-password",
      loginUrl: `${APPLICATION_URL}/login`,
      displayNameZh: "测试用户",
      displayNameEn: "Test User",
      mustChangePassword: true,
      mfaRequired: true,
    },
    "communication-message": {
      subject: "Application follow-up",
      body: "A safe unit-test message.",
      recipientName: "Test Recipient",
    },
    "calendar-invite": {
      eventVersion: 1,
      attendeeName: "Test Recipient",
      appointment,
    },
    "calendar-update": {
      eventVersion: 2,
      attendeeName: "Test Recipient",
      appointment,
    },
    "calendar-cancel": {
      eventVersion: 3,
      attendeeName: "Test Recipient",
      appointment: { ...appointment, status: "CANCELLED" },
    },
  };
}

function deliveryBody(overrides = {}) {
  return {
    id: "job-123",
    to: RECIPIENT,
    template: "device-verification",
    payload: samplePayloads()["device-verification"],
    ...overrides,
  };
}

function deliveryRequest({
  pathName = DELIVERY_PATH,
  method = "POST",
  token = CRM_TOKEN,
  idempotencyKey = "job-123",
  contentType = "application/json",
  body = deliveryBody(),
  rawBody,
  headers = {},
} = {}) {
  const requestHeaders = new Headers(headers);
  if (token !== null) requestHeaders.set("authorization", `Bearer ${token}`);
  if (idempotencyKey !== null) requestHeaders.set("idempotency-key", idempotencyKey);
  if (contentType !== null) requestHeaders.set("content-type", contentType);
  const init = { method, headers: requestHeaders };
  if (!["GET", "HEAD"].includes(method)) {
    init.body = rawBody ?? JSON.stringify(body);
  }
  return new Request(`https://worker.example.test${pathName}`, init);
}

function providerDouble({
  status = 200,
  responseBody = { id: "resend-message-id" },
  error,
} = {}) {
  const calls = [];
  const fetchImplementation = async (url, init) => {
    calls.push({ url, init });
    if (error) throw error;
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImplementation };
}

async function responseJson(response) {
  return JSON.parse(await response.text());
}

test("configured health path succeeds without leaking environment values", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const secrets = environment();
  const response = await worker.fetch(
    deliveryRequest({ pathName: HEALTH_PATH, method: "GET" }),
    secrets,
  );
  assert.equal(response.status, 200);
  const serialized = await response.text();
  assert.deepEqual(JSON.parse(serialized), {
    status: "ok",
    service: "lumina-email-delivery",
  });
  for (const value of Object.values(secrets)) assert.equal(serialized.includes(value), false);
  assert.equal(provider.calls.length, 0);
});

test("unconfigured paths return 404 for both GET and POST", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  assert.equal((await worker.fetch(
    deliveryRequest({ pathName: "/missing", method: "GET" }),
    environment(),
  )).status, 404);
  assert.equal((await worker.fetch(
    deliveryRequest({ pathName: "/missing", method: "POST" }),
    environment(),
  )).status, 404);
});

test("non-POST methods cannot enter delivery logic", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const getResponse = await worker.fetch(
    deliveryRequest({ method: "GET" }),
    environment(),
  );
  const putResponse = await worker.fetch(
    deliveryRequest({ method: "PUT" }),
    environment(),
  );
  assert.equal(getResponse.status, 404);
  assert.equal(putResponse.status, 405);
  assert.equal(provider.calls.length, 0);
});

test("missing Authorization returns the same 401 as invalid credentials", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(deliveryRequest({ token: null }), environment());
  assert.equal(response.status, 401);
  assert.deepEqual(await responseJson(response), { error: { code: "UNAUTHORIZED" } });
});

test("wrong Bearer token returns 401", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(
    deliveryRequest({ token: "wrong-unit-test-token" }),
    environment(),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(await responseJson(response), { error: { code: "UNAUTHORIZED" } });
});

test("missing configured webhook secret fails closed", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(
    deliveryRequest(),
    environment({ LUMINA_WEBHOOK_TOKEN: "" }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await responseJson(response), {
    error: { code: "SERVICE_NOT_CONFIGURED" },
  });
});

test("missing required runtime configuration fails closed", async (t) => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  for (const key of [
    "CRM_APP_URL",
    "EMAIL_FROM",
    "DELIVERY_PATH",
    "HEALTH_PATH",
    "RESEND_API_KEY",
    "EMAIL_BRAND_NAME",
  ]) {
    await t.test(key, async () => {
      const response = await worker.fetch(
        deliveryRequest(),
        environment({ [key]: "" }),
      );
      assert.equal(response.status, 503);
      assert.deepEqual(await responseJson(response), {
        error: { code: "SERVICE_NOT_CONFIGURED" },
      });
    });
  }
});

test("invalid URL, mailbox, and route configuration fails closed", async (t) => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const invalidConfigurations = [
    { CRM_APP_URL: "http://crm.example.test" },
    { EMAIL_FROM: "not-a-mailbox" },
    { EMAIL_REPLY_TO: "not-a-mailbox" },
    { DELIVERY_PATH: "https://worker.example.test/delivery" },
    { DELIVERY_PATH: "/delivery?mode=test" },
    { HEALTH_PATH: "/health#details" },
    { HEALTH_PATH: DELIVERY_PATH },
  ];
  for (const overrides of invalidConfigurations) {
    await t.test(Object.keys(overrides)[0], async () => {
      const response = await worker.fetch(deliveryRequest(), environment(overrides));
      assert.equal(response.status, 503);
      assert.deepEqual(await responseJson(response), {
        error: { code: "SERVICE_NOT_CONFIGURED" },
      });
    });
  }
});

test("delivery and health paths are controlled only by environment bindings", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const configured = environment({
    DELIVERY_PATH: "/configured-delivery",
    HEALTH_PATH: "/configured-health",
  });
  const oldDelivery = await worker.fetch(deliveryRequest(), configured);
  const configuredDelivery = await worker.fetch(
    deliveryRequest({ pathName: "/configured-delivery" }),
    configured,
  );
  const configuredHealth = await worker.fetch(
    deliveryRequest({ pathName: "/configured-health", method: "GET" }),
    configured,
  );
  assert.equal(oldDelivery.status, 404);
  assert.equal(configuredDelivery.status, 200);
  assert.equal(configuredHealth.status, 200);
  assert.equal(provider.calls.length, 1);
});

test("non-JSON delivery requests return 415", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(
    deliveryRequest({ contentType: "text/plain", rawBody: "{}" }),
    environment(),
  );
  assert.equal(response.status, 415);
  assert.deepEqual(await responseJson(response), {
    error: { code: "CONTENT_TYPE_UNSUPPORTED" },
  });
});

test("delivery requests over 64KB return 413", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(
    deliveryRequest({ rawBody: JSON.stringify({ value: "x".repeat(70_000) }) }),
    environment(),
  );
  assert.equal(response.status, 413);
  assert.deepEqual(await responseJson(response), { error: { code: "REQUEST_TOO_LARGE" } });
});

test("missing Idempotency-Key returns 400", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(
    deliveryRequest({ idempotencyKey: null }),
    environment(),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await responseJson(response), {
    error: { code: "IDEMPOTENCY_KEY_INVALID" },
  });
});

test("unsafe or oversized idempotency keys return 400", async (t) => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  for (const value of ["bad key", "x".repeat(201), "/leading-separator"]) {
    await t.test(value.slice(0, 20), async () => {
      const response = await worker.fetch(
        deliveryRequest({ idempotencyKey: value }),
        environment(),
      );
      assert.equal(response.status, 400);
    });
  }
});

test("missing body fields return a stable client error", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(deliveryRequest({ body: {} }), environment());
  assert.equal(response.status, 400);
  assert.deepEqual(await responseJson(response), {
    error: { code: "REQUEST_ID_INVALID" },
  });
});

test("invalid or multiple recipient email input is rejected", async (t) => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  for (const to of ["not-an-email", "one@example.test,two@example.test", "a@localhost"]) {
    await t.test(to, async () => {
      const response = await worker.fetch(
        deliveryRequest({ body: deliveryBody({ to }) }),
        environment(),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await responseJson(response), {
        error: { code: "RECIPIENT_INVALID" },
      });
    });
  }
});

test("unknown template returns 422", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(
    deliveryRequest({
      body: deliveryBody({ template: "unknown-template", payload: {} }),
    }),
    environment(),
  );
  assert.equal(response.status, 422);
  assert.deepEqual(await responseJson(response), {
    error: { code: "TEMPLATE_UNKNOWN" },
  });
});

test("missing required template variable returns 422", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(
    deliveryRequest({ body: deliveryBody({ payload: {} }) }),
    environment(),
  );
  assert.equal(response.status, 422);
  assert.deepEqual(await responseJson(response), {
    error: { code: "TEMPLATE_VARIABLE_MISSING" },
  });
});

test("user-controlled text is HTML-escaped in rendered mail", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const injection = '<img src=x onerror="unitTestAttack()">';
  const response = await worker.fetch(
    deliveryRequest({
      body: deliveryBody({
        template: "communication-message",
        payload: {
          subject: injection,
          body: injection,
          recipientName: injection,
        },
      }),
    }),
    environment(),
  );
  assert.equal(response.status, 200);
  const providerBody = JSON.parse(provider.calls[0].init.body);
  assert.equal(providerBody.html.includes(injection), false);
  assert.match(providerBody.html, /&lt;img src=x onerror=&quot;unitTestAttack\(\)&quot;&gt;/);
});

test("payload cannot inject HTML or provider envelope fields", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const response = await worker.fetch(
    deliveryRequest({
      body: deliveryBody({
        template: "communication-message",
        payload: {
          ...samplePayloads()["communication-message"],
          html: "<strong>injected</strong>",
        },
      }),
    }),
    environment(),
  );
  assert.equal(response.status, 422);
  assert.equal(provider.calls.length, 0);
});

test("a valid request invokes Resend exactly once", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const response = await worker.fetch(deliveryRequest(), environment());
  assert.equal(response.status, 200);
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].url, "https://api.resend.com/emails");
});

test("Resend receives the unchanged CRM Idempotency-Key", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  await worker.fetch(
    deliveryRequest({ idempotencyKey: "calendar:job:version:INVITE" }),
    environment(),
  );
  assert.equal(
    new Headers(provider.calls[0].init.headers).get("idempotency-key"),
    "calendar:job:version:INVITE",
  );
});

test("CRM cannot override Resend from, subject, html, or reply-to", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const body = {
    ...deliveryBody(),
    from: "attacker@example.test",
    subject: "attacker subject",
    html: "<b>attacker html</b>",
    reply_to: "attacker@example.test",
  };
  const rejected = await worker.fetch(deliveryRequest({ body }), environment());
  assert.equal(rejected.status, 400);
  assert.equal(provider.calls.length, 0);

  await worker.fetch(deliveryRequest(), environment({
    EMAIL_REPLY_TO: "reply@example.test",
  }));
  const providerBody = JSON.parse(provider.calls[0].init.body);
  assert.equal(providerBody.from, "Lumina Test <sender@example.test>");
  assert.equal(providerBody.reply_to, "reply@example.test");
  assert.equal(providerBody.subject, "Your Lumina CRM verification code");
  assert.match(providerBody.html, /Lumina Education CRM/);
});

test("successful Resend response returns its message id", async () => {
  const provider = providerDouble({
    responseBody: { id: "provider-message-123" },
  });
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const response = await worker.fetch(deliveryRequest(), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { id: "provider-message-123" });
});

test("Resend 4xx maps to stable 502", async () => {
  const provider = providerDouble({
    status: 422,
    responseBody: { message: "provider detail must not escape" },
  });
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const response = await worker.fetch(deliveryRequest(), environment());
  assert.equal(response.status, 502);
  assert.deepEqual(await responseJson(response), {
    error: { code: "PROVIDER_REJECTED" },
  });
});

test("Resend 5xx maps to stable 503", async () => {
  const provider = providerDouble({
    status: 500,
    responseBody: { message: "provider detail must not escape" },
  });
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const response = await worker.fetch(deliveryRequest(), environment());
  assert.equal(response.status, 503);
  assert.deepEqual(await responseJson(response), {
    error: { code: "PROVIDER_UNAVAILABLE" },
  });
});

test("Resend timeout maps to stable 503", async () => {
  const fetchImplementation = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  const worker = createEmailDeliveryWorker({
    fetchImplementation,
    providerTimeoutMs: 5,
  });
  const response = await worker.fetch(deliveryRequest(), environment());
  assert.equal(response.status, 503);
  assert.deepEqual(await responseJson(response), {
    error: { code: "PROVIDER_UNAVAILABLE" },
  });
});

test("logs exclude recipient, payload, HTML, Bearer token, and Resend API key", async () => {
  const lines = [];
  const logger = { info: (line) => lines.push(line) };
  const provider = providerDouble({
    status: 400,
    responseBody: { message: "do-not-log-provider-body" },
  });
  const worker = createEmailDeliveryWorker({
    fetchImplementation: provider.fetchImplementation,
    logger,
  });
  const sensitivePayload = "unique-sensitive-payload-marker";
  const env = environment();
  await worker.fetch(
    deliveryRequest({
      body: deliveryBody({
        template: "communication-message",
        payload: {
          subject: "Safe test",
          body: sensitivePayload,
          recipientName: "Sensitive Test Name",
        },
      }),
    }),
    env,
  );
  const log = lines.join("\n");
  for (const secret of [
    RECIPIENT,
    sensitivePayload,
    "Sensitive Test Name",
    CRM_TOKEN,
    `Bearer ${CRM_TOKEN}`,
    RESEND_KEY,
    "<!doctype html>",
    "do-not-log-provider-body",
  ]) {
    assert.equal(log.includes(secret), false);
  }
  assert.match(log, /"requestId":"job-123"/);
  assert.match(log, /"providerResult":"rejected"/);
});

async function migrationSources() {
  const directory = path.join(repositoryRoot, "db", "migrations");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql"));
  return Promise.all(files.map((name) => readFile(path.join(directory, name), "utf8")));
}

test("every repository email template key has an explicit tested mapping", async () => {
  const discovered = new Set();
  for (const migration of await migrationSources()) {
    for (const match of migration.matchAll(
      /notification_outbox[\s\S]{0,500}?['"]EMAIL['"]\s*,\s*['"]([a-z0-9-]+)['"]/g,
    )) {
      discovered.add(match[1]);
    }
    const calendarConstraint = migration.match(
      /delivery_type\s+text[^;]+delivery_type\s+in\s*\(([^)]+)\)/s,
    );
    for (const match of calendarConstraint?.[1]?.matchAll(/'([A-Z_]+)'/g) ?? []) {
      discovered.add(`calendar-${match[1].toLowerCase()}`);
    }
  }

  const directFiles = [
    "lib/admin-users-repository.ts",
    "app/api/communications/route.ts",
  ];
  for (const file of directFiles) {
    const contents = await readFile(path.join(repositoryRoot, file), "utf8");
    for (const match of contents.matchAll(/template\s*:\s*"([a-z0-9-]+)"/g)) {
      discovered.add(match[1]);
    }
  }
  const authSource = await readFile(
    path.join(repositoryRoot, "lib", "auth", "email-tokens.ts"),
    "utf8",
  );
  for (const match of authSource.matchAll(/"(password-reset|device-verification|email-verification)"/g)) {
    discovered.add(match[1]);
  }
  assert.match(authSource, /"idempotency-key": deliveryId/);
  const staffSource = await readFile(
    path.join(repositoryRoot, "lib", "admin-users-repository.ts"),
    "utf8",
  );
  assert.match(staffSource, /"idempotency-key": deliveryId/);

  assert.deepEqual([...discovered].sort(), [...TEMPLATE_KEYS].sort());

  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  const payloads = samplePayloads();
  for (const template of TEMPLATE_KEYS) {
    const response = await worker.fetch(
      deliveryRequest({
        idempotencyKey: `template-test:${template}`,
        body: deliveryBody({
          id: `template-test:${template}`,
          template,
          payload: payloads[template],
        }),
      }),
      environment(),
    );
    assert.equal(response.status, 200, template);
  }
  assert.equal(provider.calls.length, TEMPLATE_KEYS.length);
});

test("tracked Wrangler config contains only generic deployment settings and required secrets", async () => {
  const wrangler = await readFile(path.join(workerRoot, "wrangler.toml"), "utf8");
  const deploymentReadme = await readFile(path.join(workerRoot, "README.md"), "utf8");
  assert.doesNotMatch(wrangler, /^name\s*=/m);
  assert.match(wrangler, /^main = "src\/index\.js"$/m);
  assert.match(wrangler, /^compatibility_date = "2026-07-30"$/m);
  assert.match(wrangler, /^workers_dev = false$/m);
  assert.match(wrangler, /^keep_vars = true$/m);
  assert.match(
    wrangler,
    /^\[secrets\]\s+required = \[ "LUMINA_WEBHOOK_TOKEN", "RESEND_API_KEY" \]$/m,
  );
  assert.doesNotMatch(
    wrangler,
    /(?:^|\s)(?:route|routes|vars|account_id)\s*=|custom_domain|LUMINA_WEBHOOK_TOKEN\s*=|RESEND_API_KEY\s*=/m,
  );
  assert.match(
    deploymentReadme,
    /npm run deploy:production/,
  );
  assert.doesNotMatch(deploymentReadme, /wrangler secret put/);
});

test("responses are non-cacheable, nosniff, and expose no CORS policy", async () => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const response = await worker.fetch(deliveryRequest(), environment());
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.has("access-control-allow-origin"), false);
});

test("nested arrays, nulls, and excessive payload depth are rejected", async (t) => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  const payloads = [
    [],
    null,
    { one: { two: { three: { four: { five: { six: "too deep" } } } } } },
    { values: ["arrays-are-not-supported"] },
  ];
  for (const payload of payloads) {
    await t.test(JSON.stringify(payload).slice(0, 30), async () => {
      const response = await worker.fetch(
        deliveryRequest({ body: deliveryBody({ payload }) }),
        environment(),
      );
      assert.equal(response.status, 400);
      assert.deepEqual(await responseJson(response), {
        error: { code: "PAYLOAD_INVALID" },
      });
    });
  }
});

test("template links reject external and non-HTTPS URLs", async (t) => {
  const worker = createEmailDeliveryWorker({ fetchImplementation: providerDouble().fetchImplementation });
  for (const url of [
    "https://external.example.test/reset?token=test",
    "http://crm.example.test/reset?token=test",
  ]) {
    await t.test(url, async () => {
      const response = await worker.fetch(
        deliveryRequest({
          body: deliveryBody({
            template: "password-reset",
            payload: { url, expiresInSeconds: 1_800 },
          }),
        }),
        environment(),
      );
      assert.equal(response.status, 422);
      assert.deepEqual(await responseJson(response), {
        error: { code: "TEMPLATE_URL_INVALID" },
      });
    });
  }
  await t.test("external staff login URL", async () => {
    const payload = {
      ...samplePayloads()["staff-account-created"],
      loginUrl: "https://external.example.test/login",
    };
    const response = await worker.fetch(
      deliveryRequest({
        body: deliveryBody({
          template: "staff-account-created",
          payload,
        }),
      }),
      environment(),
    );
    assert.equal(response.status, 422);
    assert.deepEqual(await responseJson(response), {
      error: { code: "TEMPLATE_URL_INVALID" },
    });
  });
});

test("provider authorization is isolated from the CRM Bearer token", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  await worker.fetch(deliveryRequest(), environment());
  const headers = new Headers(provider.calls[0].init.headers);
  assert.equal(headers.get("authorization"), `Bearer ${RESEND_KEY}`);
  assert.equal(headers.get("authorization").includes(CRM_TOKEN), false);
  const body = JSON.parse(provider.calls[0].init.body);
  assert.deepEqual(body.to, [RECIPIENT]);
  assert.equal(typeof body.html, "string");
  assert.equal(typeof body.text, "string");
});

test("email footer contains only the configured brand and exact application origin", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({ fetchImplementation: provider.fetchImplementation });
  await worker.fetch(deliveryRequest(), environment());
  const body = JSON.parse(provider.calls[0].init.body);
  assert.match(
    body.html,
    /<footer[^>]*>Lumina Education CRM<br><a href="https:\/\/crm\.example\.test"[^>]*>https:\/\/crm\.example\.test<\/a><\/footer>/,
  );
  assert.match(body.text, /Lumina Education CRM\nhttps:\/\/crm\.example\.test$/);
  assert.doesNotMatch(body.html, /Shanghai|address|telephone|phone/i);
});

test("logging sink failures do not change a successful delivery", async () => {
  const provider = providerDouble();
  const worker = createEmailDeliveryWorker({
    fetchImplementation: provider.fetchImplementation,
    logger: { info: () => { throw new Error("unit-test logger unavailable"); } },
  });
  const response = await worker.fetch(deliveryRequest(), environment());
  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { id: "resend-message-id" });
});
