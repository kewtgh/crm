import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { publicQaSummary } from "../scripts/lib/public-ci-artifacts.mjs";
import { runBounded } from "../scripts/lib/bounded-process.mjs";

const root = path.resolve(import.meta.dirname, "..");
const stage = { stage: "release", result: "FAIL", startedAt: "2026-01-01T00:00:00Z",
  completedAt: "2026-01-01T00:10:00Z", runId: "synthetic-run", runAttempt: "1" };
const privateMarker = "INVENTED-PRIVATE-MARKER";
const report = { runAt: "2026-01-01T00:01:00Z", browser: "ms-playwright/chromium-1243",
  browserVersion: "148.0.7759.0", pages: [{ url: privateMarker }], errors: [{ message: privateMarker }],
  warnings: [], executable: privateMarker, env: { token: privateMarker }, screenshot: privateMarker };

test("public schema excludes private fields on both successful and failed runs", () => {
  for (const result of ["PASS", "FAIL"]) {
    const summary = publicQaSummary(report, { ...stage, result });
    assert.deepEqual(Object.keys(summary), ["schemaVersion", "browserRevision", "releaseGate",
      "browserQa", "screenshotPublication", "browserVersion"]);
    assert.equal(summary.releaseGate, result);
    assert.equal(summary.browserQa.result, "FAIL");
    assert.equal(summary.screenshotPublication, "DISABLED");
    assert.doesNotMatch(JSON.stringify(summary), /INVENTED-PRIVATE-MARKER/);
  }
});

test("stale, missing and malformed evidence never supplies a successful QA result", () => {
  for (const candidate of [null, { ...report, runAt: "2025-01-01" },
    { ...report, browserVersion: privateMarker }, { ...report, errors: {} },
    { ...report, browserVersion: ["148.0.7759.0"] },
    { ...report, browser: "unknown-browser" }]) {
    assert.equal(publicQaSummary(candidate, stage).browserQa.result, "UNAVAILABLE");
  }
  assert.equal(publicQaSummary(report, stage, { runId: "another-run", runAttempt: "1" }).releaseGate, "NOT_RUN");
  assert.equal(publicQaSummary(report, stage, { runId: stage.runId, runAttempt: "2" }).releaseGate, "NOT_RUN");
  assert.equal(publicQaSummary({ ...report, pages: [] }, stage).browserQa.result, "FAIL");
});

test("CI stage failure keeps complete child diagnostics private and preserves the failed outcome", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "private-ci-stage-"));
  try {
    const npmFixture = path.join(temporary, "fake-npm.mjs");
    writeFileSync(npmFixture, `console.log("${privateMarker}"); console.error("synthetic-private-error"); process.exitCode=1;`);
    const result = spawnSync(process.execPath, [path.join(root, "scripts/run-private-ci-stage.mjs"), "release"],
      { cwd: temporary, env: { ...process.env, npm_execpath: npmFixture, GITHUB_RUN_ID: stage.runId,
        GITHUB_RUN_ATTEMPT: "1" }, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "CI_PRIVATE_STAGE_FAILED\n");
    const privateDir = path.join(temporary, "work/ci-private");
    const status = JSON.parse(readFileSync(path.join(privateDir, "release-status.json"), "utf8"));
    assert.equal(status.result, "FAIL");
    assert.equal(status.runId, stage.runId);
    const log = readFileSync(path.join(privateDir, "release.log"), "utf8");
    assert.match(log, /INVENTED-PRIVATE-MARKER/);
    assert.match(log, /synthetic-private-error/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("publisher copies only its fixed allowlisted summary, including on failure", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "public-ci-fixture-"));
  try {
    const raw = path.join(temporary, "work/browser-qa-chromium-1243");
    const privateDir = path.join(temporary, "work/ci-private");
    const output = path.join(temporary, "work/public-artifacts");
    for (const directory of [raw, privateDir, output]) mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(raw, "report.json"), JSON.stringify(report));
    writeFileSync(path.join(raw, "failure.png"), privateMarker);
    writeFileSync(path.join(raw, "raw.log"), privateMarker);
    writeFileSync(path.join(privateDir, "release-status.json"), JSON.stringify(stage));
    writeFileSync(path.join(output, "browser-qa-summary.json"), privateMarker);
    const result = spawnSync(process.execPath, [path.join(root, "scripts/publish-public-ci-artifacts.mjs")],
      { cwd: temporary, env: { ...process.env, GITHUB_RUN_ID: stage.runId, GITHUB_RUN_ATTEMPT: "1" }, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "CI_PUBLIC_ARTIFACTS_READY\n");
    assert.equal(result.stderr, "");
    assert.deepEqual(readdirSync(output), ["browser-qa-summary.json"]);
    const published = readFileSync(path.join(output, "browser-qa-summary.json"), "utf8");
    assert.doesNotMatch(published, /INVENTED-PRIVATE-MARKER/);
    assert.equal(JSON.parse(published).browserQa.result, "FAIL");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("private output sinks retain diagnostics without relaying child contents to Actions logs", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  const captured = [];
  const sink = { write: data => captured.push(String(data)) };
  const pending = runBounded({ command: "synthetic-command", timeoutMs: 2000, idleTimeoutMs: 2000,
    stdout: sink, stderr: sink, spawnProcess: () => child });
  child.stdout.emit("data", privateMarker); child.stderr.emit("data", "synthetic-error");
  child.emit("exit", 0, null);
  assert.equal((await pending).code, 0);
  assert.deepEqual(captured, [privateMarker, "synthetic-error"]);
});
