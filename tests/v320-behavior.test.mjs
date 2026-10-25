import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calendarActionSchema,
  parseCalendarAction,
} from "../lib/calendar-actions.ts";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);

test("rejects malformed calendar actions without inferring a business transition", () => {
  for (const value of [{}, null, "", { action: "complete" }, { action: "UPDATE" }]) {
    assert.equal(parseCalendarAction(value).success, false);
  }
  assert.equal(parseCalendarAction({ action: "COMPLETE",expectedVersion:1,requestKey:"fictional-request" }).success, true);
  assert.equal(parseCalendarAction({ action: "CANCEL",expectedVersion:1,requestKey:"fictional-request" }).success, true);
  assert.equal(calendarActionSchema.safeParse({
    action: "UPDATE",expectedVersion:1,requestKey:"fictional-request",
    date: "2026-07-30",
    time: "09:45",
  }).success, true);
});

test("persists appointment request fingerprints and closes the malformed JSON fallback", async () => {
  const [migration, createRoute, actionRoute, repository, calendar] = await Promise.all([
    readFile(repositoryFile("db/migrations/202607290063_v320_delivery_integrity.sql"), "utf8"),
    readFile(repositoryFile("lib/calendar-actions.ts"), "utf8"),
    readFile(repositoryFile("app/api/calendar/[id]/route.ts"), "utf8"),
    readFile(repositoryFile("lib/calendar-repository.ts"), "utf8"),
    readFile(repositoryFile("components/calendar-editor.tsx"), "utf8"),
  ]);
  assert.match(migration, /appointments_creation_request_uidx/);
  assert.match(migration, /creation_request_fingerprint/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /appointment_idempotency_conflict/);
  assert.match(migration, /target_request_key text/);
  assert.match(createRoute, /requestKey:z\.string\(\)\.trim\(\)\.min\(8\)\.max\(160\)/);
  assert.match(repository, /target_request_key:input\.requestKey/);
  assert.match(calendar, /createReceiptAttempt/);
  assert.match(calendar, /disabled=\{pending\|\|uncertain\}/);
  assert.doesNotMatch(actionRoute, /catch\(\(\)=>\(\{action:"COMPLETE"\}\)\)/);
  assert.match(actionRoute, /parseCalendarAction\(await request\.json\(\)\.catch\(\(\) => \(\{\}\)\)\)/);
});

test("reports communication result capacity and blocks duplicate client operations", async () => {
  const [migration, route, component, workspace] = await Promise.all([
    readFile(repositoryFile("db/migrations/202607290063_v320_delivery_integrity.sql"), "utf8"),
    readFile(repositoryFile("app/api/communications/route.ts"), "utf8"),
    readFile(repositoryFile("components/communications-inbox-page.tsx"), "utf8"),
    readFile(repositoryFile("hooks/use-communications-workspace.ts"), "utf8"),
  ]);
  assert.match(migration, /'total',\(select count\(\*\) from filtered\)/);
  assert.match(migration, /'truncated',\(select count\(\*\) from filtered\)>jsonb_array_length/);
  assert.doesNotMatch(route, /postCommunicationDelivery|configuredCommunicationDelivery|fetch\(/);
  assert.match(route, /communicationResultSchema.parse\(await executeCommunicationCommand/);
  assert.match(workspace, /!canManage\|\|busy.current/);
  assert.match(workspace, /original.current=JSON.stringify\(parsed.data\)/);
  assert.doesNotMatch(component, /<Search size=/);
});
