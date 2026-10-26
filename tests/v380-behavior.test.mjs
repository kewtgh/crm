import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {globalSearchHookHarness} from "./helpers/global-search-hook-harness.mjs";

const repositoryFile = (value) => new URL(`../${value}`, import.meta.url);
const source = (value) => readFile(repositoryFile(value), "utf8");

test("signs out through the CSRF-aware API client with pending and error states", async () => {
  const [route, shell, styles, browserQa] = await Promise.all([
    source("app/api/auth/logout/route.ts"),
    source("components/app-shell.tsx"),
    source("app/globals.css"),
    source("scripts/browser-qa-chromium-1248.cjs"),
  ]);
  assert.match(route, /mutationIsTrusted\(request\)/);
  assert.match(route, /includes\("application\/json"\)[\s\S]+status: 204/);
  assert.match(shell, /apiFetch<void>\("\/api\/auth\/logout",\{method:"POST"\}\)/);
  assert.match(shell, /className="profile-signout"/);
  assert.match(shell, /aria-busy=\{signingOut\}/);
  assert.match(shell, /nav\.signOutFailed/);
  assert.doesNotMatch(shell, /form action="\/api\/auth\/logout"/);
  assert.match(styles, /\.profile-signout:disabled/);
  assert.match(browserQa, /Secure sign-out returned/);
  assert.match(browserQa, /waitForURL\(url=>url\.pathname==="\/login"/);
});

test("clears stale search records and normalizes finite progress consistently", async context => {
  const result=(query,scope="all")=>({query,scope,items:[{id:"00000000-0000-4000-8000-000000000001",type:scope==="TASK"?"TASK":"CONTACT",labelZh:query,labelEn:query}],sources:[],truncated:false});

  await context.test("query changes immediately clear records/errors and cancel the previous request",async context=>{
    const h=await globalSearchHookHarness(context);let view=h.render();view.setQuery("Fictional first");view=h.render();assert.equal(view.loading,true);await h.tick();
    h.requests[0].resolve(result("Fictional first"));await h.settle();view=h.render();assert.equal(view.result.items[0].labelEn,"Fictional first");
    view.setQuery("Fictional second");view=h.render({commit:false});assert.equal(h.requests[0].signal.aborted,true);assert.equal(view.result,undefined);assert.equal(view.failed,false);assert.equal(view.loading,true);
    h.render();await h.tick();h.requests[1].reject(new Error("FICTIONAL_FAILURE"));await h.settle();view=h.render();assert.equal(view.failed,true);
    view.setQuery("Fictional third");view=h.render({commit:false});assert.equal(view.failed,false);assert.equal(view.result,undefined);assert.equal(view.loading,true);
    h.render();await h.tick();h.requests[2].resolve(result("Fictional third"));await h.settle();assert.equal(h.render().result.query,"Fictional third");
  });
  await context.test("delayed successes and failures cannot replace a newer confirmed result",async context=>{
    const h=await globalSearchHookHarness(context);let view=h.render();view.setQuery("Fictional old");h.render();await h.tick();
    h.render().setQuery("Fictional current");h.render();await h.tick();assert.equal(h.requests[0].signal.aborted,true);
    h.requests[1].resolve(result("Fictional current"));await h.settle();assert.equal(h.render().result.query,"Fictional current");
    // The transport adapter deliberately ignores abort and still returns its old payload.
    h.requests[0].resolve(result("Fictional old"));await h.settle();assert.equal(h.render().result.query,"Fictional current");
    h.render().setQuery("Fictional failure");h.render();await h.tick();h.render().setQuery("Fictional final");h.render();await h.tick();
    h.requests[3].resolve(result("Fictional final"));await h.settle();h.requests[2].reject(new Error("FICTIONAL_LATE_FAILURE"));await h.settle();view=h.render();assert.equal(view.result.query,"Fictional final");assert.equal(view.failed,false);
  });
  await context.test("scope changes hide mismatched records immediately and pages scope issues no request",async context=>{
    const h=await globalSearchHookHarness(context);h.render().setQuery("Fictional scope");h.render();await h.tick();h.requests[0].resolve(result("Fictional scope"));await h.settle();assert.equal(h.render().result.scope,"all");
    h.render().setScope("TASK");let view=h.render({commit:false});assert.equal(view.result,undefined);assert.equal(view.failed,false);assert.equal(h.requests[0].signal.aborted,true);
    h.render();await h.tick();assert.equal(new URL(h.requests[1].url,"https://example.test").searchParams.get("type"),"TASK");h.requests[1].resolve(result("Fictional scope","TASK"));await h.settle();assert.equal(h.render().result.items[0].type,"TASK");
    h.render().setScope("all");h.render();await h.tick();h.render().setScope("TASK");view=h.render({commit:false});assert.equal(view.result,undefined);assert.equal(h.requests[2].signal.aborted,true);h.render();await h.tick();h.requests[3].resolve(result("Fictional scope","TASK"));await h.settle();h.requests[2].resolve(result("Fictional scope"));await h.settle();assert.equal(h.render().result.scope,"TASK");
    h.render().setScope("pages");view=h.render();assert.equal(view.result,undefined);assert.equal(view.loading,false);await h.tick();assert.equal(h.requests.length,4);
  });
  await context.test("clearing cancels debounce and equivalent whitespace does not discard matching results",async context=>{
    const h=await globalSearchHookHarness(context);h.render().setQuery("Fictional clear");h.render();h.render().setQuery("");let view=h.render();await h.tick();assert.equal(h.requests.length,0);assert.equal(view.loading,false);assert.equal(view.result,undefined);
    view.setQuery("Fictional stable");h.render();await h.tick();h.requests[0].resolve(result("Fictional stable"));await h.settle();view=h.render();view.setQuery("Fictional stable ");view=h.render();assert.equal(view.result.query,"Fictional stable");assert.equal(h.requests[0].signal.aborted,false);await h.tick();assert.equal(h.requests.length,1);
  });

  const ui=await source("components/ui.tsx");
  assert.match(ui, /Number\.isFinite\(value\)\?Math\.min\(100,Math\.max\(0,value\)\):0/);
  assert.match(ui, /const renderedLabel=label\?\?/);
  assert.doesNotMatch(ui, /\{label \?\? `\$\{value\}%`\}/);
});

test("monitors current rootless Compose storage with strict thresholds", async () => {
  const [monitor, unit, environment] = await Promise.all([
    source("scripts/check-disk-space.mjs"),
    source("deploy/systemd/lumina-crm-disk-monitor.service"),
    source("deploy/deploy.env.example"),
  ]);
  assert.match(monitor, /DISK_FREE_PERCENT_THRESHOLD_INVALID/);
  assert.match(monitor, /DISK_FREE_PERCENT_THRESHOLD_MUST_BE_5_TO_50/);
  assert.match(
    monitor,
    /\/,\/var\/lib\/lumina-crm\/docker,\/var\/lib\/lumina-crm\/deployments/,
  );
  assert.match(unit, /WorkingDirectory=\/opt\/lumina-crm\/source/);
  assert.match(environment, /DISK_MONITOR_PATHS=\/,\/var\/lib\/lumina-crm\/docker,\/var\/lib\/lumina-crm\/deployments/);
});
