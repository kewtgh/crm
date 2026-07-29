import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryFile = (path) => new URL(`../${path}`, import.meta.url);

test("makes communication thread creation replay-safe at the database boundary", async () => {
  const [migration, repository, route, component] = await Promise.all([
    readFile(repositoryFile("db/migrations/202607290064_v330_communication_scalability.sql"), "utf8"),
    readFile(repositoryFile("lib/v220-repository.ts"), "utf8"),
    readFile(repositoryFile("app/api/communications/route.ts"), "utf8"),
    readFile(repositoryFile("components/communications-inbox-page.tsx"), "utf8"),
  ]);
  assert.match(migration, /communication_threads_creation_request_uidx/);
  assert.match(migration, /creation_request_fingerprint/);
  assert.match(migration, /extensions\.digest/);
  assert.match(migration, /communication_thread_idempotency_conflict/);
  assert.match(migration, /target_request_key text/);
  assert.match(repository, /target_request_key:input\.requestKey/);
  assert.match(route, /requestKey:z\.string\(\)\.trim\(\)\.min\(8\)\.max\(160\)/);
  assert.match(component, /threadRequest\.current=request/);
  assert.match(component, /requestKey:request\.key/);
  assert.match(component, /onChange=\{\(\)=>\{if\(!pending\)threadRequest\.current=null;\}\}/);
});

test("grants one bounded owner for provider delivery and skips successful replays", async () => {
  const [migration, route] = await Promise.all([
    readFile(repositoryFile("db/migrations/202607290064_v330_communication_scalability.sql"), "utf8"),
    readFile(repositoryFile("app/api/communications/route.ts"), "utf8"),
  ]);
  assert.match(migration, /returns jsonb/);
  assert.match(migration, /'shouldDeliver',should_deliver/);
  assert.match(migration, /delivery_status='QUEUED'/);
  assert.match(migration, /last_attempt_at<=now\(\)-interval '20 seconds'/);
  assert.match(migration, /'shouldDeliver',false/);
  assert.match(migration, /'shouldDeliver',true/);
  assert.match(route, /if\(queued\.shouldDeliver\)await deliver/);
  assert.match(route, /deliveryStarted:queued\.shouldDeliver/);
  assert.doesNotMatch(route, /return NextResponse\.json\(await loadCommunications\(\)\)/);
});

test("paginates conversation summaries and one selected message history independently", async () => {
  const [migration, repository, route, component] = await Promise.all([
    readFile(repositoryFile("db/migrations/202607290064_v330_communication_scalability.sql"), "utf8"),
    readFile(repositoryFile("lib/v220-repository.ts"), "utf8"),
    readFile(repositoryFile("app/api/communications/route.ts"), "utf8"),
    readFile(repositoryFile("components/communications-inbox-page.tsx"), "utf8"),
  ]);
  assert.match(migration, /communication_inbox_page/);
  assert.match(migration, /communication_thread_snapshot/);
  assert.match(migration, /limit \(select page_size from parameters\)/);
  assert.match(migration, /limit message_page_size/);
  const inboxFunction = migration.slice(
    migration.indexOf("create or replace function public.communication_inbox_page"),
    migration.indexOf("create or replace function public.communication_thread_snapshot"),
  );
  assert.doesNotMatch(inboxFunction, /'messages'/);
  assert.match(repository, /CommunicationInboxResult=\{items:CommunicationThreadSummary\[\];total:number;page:number;pageSize:number\}/);
  assert.match(repository, /loadCommunicationThread/);
  assert.match(route, /parsePagination\(params,20\)/);
  assert.match(route, /messagePagination\.safeParse/);
  assert.equal((component.match(/<Pagination /g)??[]).length,2);
  assert.match(component, /q:nextQuery\.trim\(\)/);
  assert.match(component, /messagePageSize:String\(messagePageSize\)/);
  assert.doesNotMatch(component, /const visible=/);
  assert.doesNotMatch(component, /communications\.truncated/);
});
