import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calendarActionSchema,
  parseCalendarAction,
} from "../lib/calendar-actions.ts";
import {
  COMMUNICATION_DELIVERY_TIMEOUT_MS,
  communicationDeliveryHeaders,
} from "../lib/communication-delivery.ts";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);

test("rejects malformed calendar actions without inferring a business transition", () => {
  for (const value of [{}, null, "", { action: "complete" }, { action: "UPDATE" }]) {
    assert.equal(parseCalendarAction(value).success, false);
  }
  assert.equal(parseCalendarAction({ action: "COMPLETE" }).success, true);
  assert.equal(parseCalendarAction({ action: "CANCEL" }).success, true);
  assert.equal(calendarActionSchema.safeParse({
    action: "UPDATE",
    date: "2026-07-30",
    time: "09:45",
  }).success, true);
});

test("keeps provider delivery inside the client budget with a stable idempotency header", () => {
  assert.equal(COMMUNICATION_DELIVERY_TIMEOUT_MS, 10_000);
  assert.ok(COMMUNICATION_DELIVERY_TIMEOUT_MS < 15_000);
  assert.deepEqual(communicationDeliveryHeaders("message-123"), {
    "content-type": "application/json",
    "idempotency-key": "message-123",
  });
  assert.equal(
    communicationDeliveryHeaders("message-123", "token").authorization,
    "Bearer token",
  );
});

test("persists appointment request fingerprints and closes the malformed JSON fallback", async () => {
  const [migration, createRoute, actionRoute, repository, calendar] = await Promise.all([
    readFile(repositoryFile("db/migrations/202607290063_v320_delivery_integrity.sql"), "utf8"),
    readFile(repositoryFile("app/api/calendar/route.ts"), "utf8"),
    readFile(repositoryFile("app/api/calendar/[id]/route.ts"), "utf8"),
    readFile(repositoryFile("lib/calendar-repository.ts"), "utf8"),
    readFile(repositoryFile("components/calendar-page.tsx"), "utf8"),
  ]);
  assert.match(migration, /appointments_creation_request_uidx/);
  assert.match(migration, /creation_request_fingerprint/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /appointment_idempotency_conflict/);
  assert.match(migration, /target_request_key text/);
  assert.match(createRoute, /requestKey:z\.string\(\)\.trim\(\)\.min\(8\)\.max\(160\)/);
  assert.match(repository, /target_request_key:input\.requestKey/);
  assert.match(calendar, /scheduleRequestKey\.current\?\?=crypto\.randomUUID\(\)/);
  assert.match(calendar, /onChange=\{\(\)=>\{if\(!schedulePending\)scheduleRequestKey\.current=null;\}\}/);
  assert.doesNotMatch(actionRoute, /catch\(\(\)=>\(\{action:"COMPLETE"\}\)\)/);
  assert.match(actionRoute, /parseCalendarAction\(await request\.json\(\)\.catch\(\(\) => \(\{\}\)\)\)/);
});

test("reports communication result capacity and blocks duplicate client operations", async () => {
  const [migration, route, component] = await Promise.all([
    readFile(repositoryFile("db/migrations/202607290063_v320_delivery_integrity.sql"), "utf8"),
    readFile(repositoryFile("app/api/communications/route.ts"), "utf8"),
    readFile(repositoryFile("components/communications-inbox-page.tsx"), "utf8"),
  ]);
  assert.match(migration, /'total',\(select count\(\*\) from filtered\)/);
  assert.match(migration, /'truncated',\(select count\(\*\) from filtered\)>jsonb_array_length/);
  assert.match(route, /communicationDeliveryHeaders\(message\.id/);
  assert.match(route, /AbortSignal\.timeout\(COMMUNICATION_DELIVERY_TIMEOUT_MS\)/);
  assert.match(component, /if\(operationLock\.current\)return null/);
  assert.match(component, /messageRequest\.current=request/);
  assert.doesNotMatch(component, /<Search size=/);
});
