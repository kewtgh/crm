import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repositoryFile = (value) => new URL(`../${value}`, import.meta.url);
const source = (value) => readFile(repositoryFile(value), "utf8");

test("signs out through the CSRF-aware API client with pending and error states", async () => {
  const [route, shell, styles, browserQa] = await Promise.all([
    source("app/api/auth/logout/route.ts"),
    source("components/app-shell.tsx"),
    source("app/globals.css"),
    source("scripts/browser-qa-chromium-1228.cjs"),
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

test("clears stale search records and normalizes finite progress consistently", async () => {
  const [shell, ui] = await Promise.all([
    source("components/app-shell.tsx"),
    source("components/ui.tsx"),
  ]);
  assert.match(
    shell,
    /const changeSearch = \(value: string\) => \{[\s\S]+setRecordSearchResults\(\[\]\);[\s\S]+setSearchError\(""\)/,
  );
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
