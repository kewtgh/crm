import crypto from "node:crypto";

const required = [
  "APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRM_WORKSPACE_ID",
  "WEBHOOK_EMAIL_SECRET",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) throw new Error(`Missing v1.0 HTTP smoke variables: ${missing.join(", ")}`);

const app = process.env.APP_URL.replace(/\/$/, "");
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const eventId = `v100-${Date.now()}-${crypto.randomUUID()}`;
const eventType = "delivery.v100-smoke";
const rawBody = JSON.stringify({ smoke: true, release: "2.1.1" });
const timestamp = String(Math.floor(Date.now() / 1000));
const bodyDigest = crypto.createHash("sha256").update(rawBody).digest("hex");
const canonical = ["v1", "EMAIL", eventId, eventType, timestamp, bodyDigest].join("\n");
const signature = crypto.createHmac("sha256", process.env.WEBHOOK_EMAIL_SECRET)
  .update(canonical)
  .digest("hex");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function webhook(headers = {}, body = rawBody) {
  const response = await fetch(`${app}/api/integrations/webhooks/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-event-id": eventId,
      "x-event-type": eventType,
      "x-event-timestamp": timestamp,
      "x-webhook-signature": `sha256=${signature}`,
      ...headers,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return {
    response,
    body: await response.json().catch(() => ({})),
  };
}

try {
  const crossSite = await fetch(`${app}/api/next-actions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
    },
    body: JSON.stringify({ operation: "generate", organizationId: null }),
    signal: AbortSignal.timeout(10_000),
  });
  assert(crossSite.status === 403, `cross-site mutation returned ${crossSite.status}`);

  const badSignature = await webhook({ "x-webhook-signature": `sha256=${"0".repeat(64)}` });
  assert(
    badSignature.response.status === 401,
    `invalid webhook signature returned ${badSignature.response.status}`,
  );

  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 601);
  const staleCanonical = ["v1", "EMAIL", eventId, eventType, staleTimestamp, bodyDigest].join("\n");
  const staleSignature = crypto.createHmac("sha256", process.env.WEBHOOK_EMAIL_SECRET)
    .update(staleCanonical)
    .digest("hex");
  const stale = await webhook({
    "x-event-timestamp": staleTimestamp,
    "x-webhook-signature": `sha256=${staleSignature}`,
  });
  assert(stale.response.status === 401, "stale webhook envelope was accepted");

  const accepted = await webhook();
  assert(accepted.response.status === 202 && accepted.body.accepted === true, "valid webhook was not accepted");
  assert(accepted.body.duplicate === false, "first webhook delivery was marked duplicate");

  const duplicate = await webhook();
  assert(
    duplicate.response.status === 202 && duplicate.body.duplicate === true,
    `webhook replay result was ${duplicate.response.status} ${JSON.stringify(duplicate.body)}`,
  );

  const tampered = await webhook({ "x-event-id": `${eventId}-tampered` });
  assert(tampered.response.status === 401, "a tampered event ID reused the original signature");

  process.stdout.write(
    "v2.1.1 HTTP security smoke passed: trusted origin, canonical signature, replay window, header tamper rejection, and event deduplication.\n",
  );
} finally {
  await fetch(
    `${supabase}/rest/v1/webhook_inbox?provider=eq.EMAIL&event_id=eq.${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { apikey: service, authorization: `Bearer ${service}` },
      signal: AbortSignal.timeout(10_000),
    },
  ).catch(() => undefined);
}
