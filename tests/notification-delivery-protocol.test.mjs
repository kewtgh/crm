import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  deliveryWebhookFailureCode,
  postDeliveryWebhook,
} from "../scripts/lib/delivery-webhook.mjs";
import {
  externalNotificationPayload,
  notificationInvitationDeliveryId,
  STAFF_ACCOUNT_CREATED_EXTERNAL_FIELDS,
} from "../scripts/lib/notification-delivery-protocol.mjs";
import {
  renderTemplate,
  TEMPLATE_DEFINITIONS,
} from "../infrastructure/email-delivery-worker/src/templates.js";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);

const internalInvitationPayload = Object.freeze({
  username:"new.staff",
  encryptedTemporaryPassword:"encrypted-credential-sentinel",
  invitationDeliveryId:"11111111-1111-4111-8111-111111111111",
  loginUrl:"https://crm.example.net/login",
  displayNameZh:"新同事",
  displayNameEn:"New Staff",
  mustChangePassword:true,
  mfaRequired:true,
  internalDatabaseMetadata:"must-not-cross-the-protocol-boundary",
});

test("projects staff invitation state into the exact external template payload", async () => {
  const persistedBefore = structuredClone(internalInvitationPayload);
  const decryptedValues = [];
  const externalPayload = externalNotificationPayload(
    "staff-account-created",
    internalInvitationPayload,
    {
      decryptCredential(value) {
        decryptedValues.push(value);
        return "temporary-password-sentinel";
      },
    },
  );

  assert.deepEqual(decryptedValues, ["encrypted-credential-sentinel"]);
  assert.deepEqual(Object.keys(externalPayload), STAFF_ACCOUNT_CREATED_EXTERNAL_FIELDS);
  assert.deepEqual(externalPayload, {
    username:"new.staff",
    temporaryPassword:"temporary-password-sentinel",
    loginUrl:"https://crm.example.net/login",
    displayNameZh:"新同事",
    displayNameEn:"New Staff",
    mustChangePassword:true,
    mfaRequired:true,
  });
  assert.equal(Object.hasOwn(externalPayload, "invitationDeliveryId"), false);
  assert.equal(Object.hasOwn(externalPayload, "encryptedTemporaryPassword"), false);
  assert.equal(Object.hasOwn(externalPayload, "internalDatabaseMetadata"), false);
  assert.deepEqual(internalInvitationPayload, persistedBefore);

  let requestBody;
  await postDeliveryWebhook({
    endpoint:"https://mailer.example.net/delivery",
    idempotencyKey:"notification-outbox-job-id",
    payload:{
      id:"notification-outbox-job-id",
      to:"recipient@example.net",
      template:"staff-account-created",
      payload:externalPayload,
    },
    fetchImplementation:async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(null, { status:202 });
    },
  });
  assert.deepEqual(Object.keys(requestBody.payload), STAFF_ACCOUNT_CREATED_EXTERNAL_FIELDS);
  assert.equal(requestBody.id, "notification-outbox-job-id");
});

test("keeps invitation metadata local for delivery-state recording", async () => {
  assert.equal(
    notificationInvitationDeliveryId("staff-account-created", internalInvitationPayload),
    internalInvitationPayload.invitationDeliveryId,
  );
  assert.equal(notificationInvitationDeliveryId("reminder", internalInvitationPayload), null);

  const source = await readFile(repositoryFile("scripts/process-notification-outbox.mjs"), "utf8");
  assert.match(source, /notificationInvitationDeliveryId\(job\.template_key, job\.payload\)/);
  assert.match(source, /record_staff_invitation_delivery/);
  assert.match(source, /delivery_id:invitationDeliveryId,delivery_status:"FAILED"/);
  assert.match(source, /delivery_id:invitationDeliveryId,delivery_status:"SENT"/);
  assert.match(source, /idempotencyKey:job\.id/);
  assert.doesNotMatch(source, /\.\.\.job\.payload/);
});

test("leaves non-staff notification payloads unchanged", () => {
  const payload = { reminderId:"reminder-1", locale:"en", timezone:"Asia/Taipei" };
  let decryptCalled = false;
  const externalPayload = externalNotificationPayload("reminder", payload, {
    decryptCredential() {
      decryptCalled = true;
    },
  });
  assert.equal(externalPayload, payload);
  assert.deepEqual(externalPayload, payload);
  assert.equal(decryptCalled, false);
});

test("keeps the CRM producer and Email Worker staff template contracts identical", () => {
  const definition = TEMPLATE_DEFINITIONS["staff-account-created"];
  assert.deepEqual(STAFF_ACCOUNT_CREATED_EXTERNAL_FIELDS, definition.requiredPayloadFields);
  assert.deepEqual(definition.optionalPayloadFields, []);

  const externalPayload = externalNotificationPayload(
    "staff-account-created",
    internalInvitationPayload,
    { decryptCredential:() => "temporary-password-sentinel" },
  );
  const rendered = renderTemplate("staff-account-created", externalPayload, {
    brandName:"Lumina CRM",
    applicationUrl:"https://crm.example.net",
  });
  assert.match(rendered.subject, /Lumina Education CRM account/);
});

test("maps only bounded allow-listed Email Worker 4xx error codes", async () => {
  const cases = [
    ["TEMPLATE_VARIABLE_INVALID", "DELIVERY_REMOTE_TEMPLATE_VARIABLE_INVALID"],
    ["TEMPLATE_VARIABLE_MISSING", "DELIVERY_REMOTE_TEMPLATE_VARIABLE_MISSING"],
    ["TEMPLATE_URL_INVALID", "DELIVERY_REMOTE_TEMPLATE_URL_INVALID"],
    ["RECIPIENT_INVALID", "DELIVERY_REMOTE_RECIPIENT_INVALID"],
  ];
  for (const [remoteCode, expected] of cases) {
    const response = Response.json({ error:{ code:remoteCode, message:"provider text must be discarded" } }, { status:422 });
    assert.equal(await deliveryWebhookFailureCode(response), expected);
  }

  const arbitrary = Response.json({ error:{ code:"ARBITRARY_PROVIDER_SECRET", message:"do not persist me" } }, { status:422 });
  assert.equal(await deliveryWebhookFailureCode(arbitrary), "DELIVERY_HTTP_422");
  const inheritedProperty = Response.json({ error:{ code:"constructor" } }, { status:422 });
  assert.equal(await deliveryWebhookFailureCode(inheritedProperty), "DELIVERY_HTTP_422");
  const oversized = new Response("x".repeat(4_097), { status:422 });
  assert.equal(await deliveryWebhookFailureCode(oversized), "DELIVERY_HTTP_422");
  const serverFailure = Response.json({ error:{ code:"TEMPLATE_VARIABLE_INVALID" } }, { status:503 });
  assert.equal(await deliveryWebhookFailureCode(serverFailure), "DELIVERY_HTTP_503");
});

test("notification outbox logs only bounded status diagnostics", async () => {
  const source = await readFile(repositoryFile("scripts/process-notification-outbox.mjs"), "utf8");
  const logStatements = [...source.matchAll(/process\.(?:stderr|stdout)\.write\(([^;]+)\);/gs)]
    .map((match) => match[1])
    .join("\n");
  assert.match(logStatements, /failure\.code/);
  assert.match(logStatements, /failure\.httpStatus/);
  assert.doesNotMatch(logStatements, /payload|password|credential|recipient|email|loginUrl/i);
  assert.doesNotMatch(source, /JSON\.stringify\(job\.payload\)/);
  assert.doesNotMatch(source, /console\.(?:log|error|warn)\(/);
});
