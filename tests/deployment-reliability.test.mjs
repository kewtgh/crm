import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { once } from "node:events";
import { runBootstrap, updateSourceAndResolveTarget } from "../scripts/deploy-production-bootstrap.mjs";
import { classifyGitFailure, fetchWithRetry } from "../scripts/lib/deployment-git.mjs";
import { assertEarlyRequestRecoverable, assertPendingAcceptance, deploymentFailureDisposition, resumeCandidateAcceptance } from "../scripts/lib/deployment-recovery.mjs";
import { schemaEvidence, schemasMatch, applicationRollbackDecision, readDatabaseSchema } from "../scripts/lib/deployment-schema.mjs";
import { waitForPublicEdge } from "../scripts/lib/public-edge-health.mjs";
import { finalizeTerminalDeployment, reconcileTerminalDeployment, terminalReconciliationEvidence } from "../scripts/lib/deployment-finalization.mjs";
import { runProductionReleaseWorkflow } from "../scripts/lib/production-deploy-workflow.mjs";
import { assertDeploymentRuntime } from "../scripts/lib/deployment-runtime.mjs";
import { durableDeploymentWrite } from "../scripts/lib/deployment-state-write.mjs";
import { diagnoseTunnel } from "../scripts/lib/tunnel-diagnostics.mjs";
import { writeExclusiveRequest } from "../scripts/lib/production-deploy-core.mjs";

const requestId = "12345678-1234-1234-1234-123456789abc";
const a = "a".repeat(40), b = "b".repeat(40);
const manifest = count => schemaEvidence(Array.from({ length: count }, (_, index) => ({ name: `${String(index + 1).padStart(3, "0")}_example.sql`, checksum: String(index).padStart(64, "0") })));
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "deployment-reliability-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }));
  await mkdir(path.join(root, "scripts")); await mkdir(path.join(root, "state"));
  await writeFile(path.join(root, "package.json"), '{"version":"1.0.1"}');
  await writeFile(path.join(root, "scripts/deploy-production-runner.mjs"), "");
  const requestPath = path.join(root, "state/request.json");
  const request = { requestId, mode: "deploy", sourceRoot: root, requestedAt: new Date().toISOString() };
  await writeFile(requestPath, JSON.stringify(request));
  const latestPath = path.join(root, "state/latest.json");
  return { root, requestPath, latestPath, request, read: async file => JSON.parse(await readFile(file, "utf8")) };
}

test("proxy outage, same-ID recovery, immutable target, exactly-once archive and next admission", async t => {
  const f = await fixture(t);
  let online = false, head = a, fetches = 0, controllers = 0;
  const git = async args => {
    switch (args[0]) {
      case "branch": return "main";
      case "remote": return "https://github.com/kewtgh/crm.git";
      case "status": return "";
      case "rev-parse": return args[1] === "HEAD" ? head : b;
      case "merge": head = args[2]; return "";
      case "fetch": fetches++; if (!online) throw new Error("Failed to connect proxy http://fiction:private@proxy.example.test:9000 token=secret"); return "";
    }
  };
  const updateSource = options => updateSourceAndResolveTarget({ ...options, git,
    configuredProxy: "http://fiction:private@proxy.example.test:9000", delay: async () => {} });
  await assert.rejects(runBootstrap({ requestPath: f.requestPath, sourceRoot: f.root, updateSource,
    spawnController: () => { controllers++; } }), /BOOTSTRAP_GIT_PROXY_UNAVAILABLE/);
  const failed = await f.read(f.latestPath);
  assert.equal(fetches, 3); assert.equal(controllers, 0); assert.equal(head, a);
  assert.equal(failed.stage, "git-fetch"); assert.equal(failed.attempts.length, 1);
  assertEarlyRequestRecoverable({ request: f.request, latest: failed, mode: "deploy" });
  assert.doesNotMatch(JSON.stringify(failed), /proxy\.example|private|token=|secret/);
  online = true;
  const archive = path.join(f.root, "state/archive.json"), status = path.join(f.root, "state/controller.json");
  const exit = await runBootstrap({ requestPath: f.requestPath, sourceRoot: f.root, updateSource,
    spawnController: async ({ targetCommit }) => {
      controllers++; assert.equal(targetCommit, b);
      const current = await f.read(f.latestPath);
      assert.equal(current.attempts.length, 2);
      finalizeTerminalDeployment({ currentState: { ...current, deploymentId: "fixture" }, result: "SUCCESS",
        startedAt: new Date(), requestPath: f.requestPath, requestArchivePath: archive, statusPath: status,
        latestPath: f.latestPath, exists: existsSync, rename: renameSync, atomicWrite: durableDeploymentWrite });
      return { code: 0 };
    } });
  assert.equal(exit, 0); assert.equal(controllers, 1); assert.equal(head, b);
  assert.equal((await f.read(archive)).requestId, requestId);
  assert.equal(existsSync(f.requestPath), false);
  await writeExclusiveRequest({ writeFile }, f.requestPath, { ...f.request, requestId: "22345678-1234-1234-1234-123456789abc" });
  const race = await Promise.allSettled([writeExclusiveRequest({ writeFile }, f.requestPath, f.request), writeExclusiveRequest({ writeFile }, f.requestPath, f.request)]);
  assert.equal(race.filter(result => result.status === "rejected").length, 2);
});

test("concurrent fresh request admission has exactly one winner", async t => {
  const f = await fixture(t); await rm(f.requestPath);
  const race = await Promise.allSettled(Array.from({ length: 5 }, () => writeExclusiveRequest({ writeFile }, f.requestPath, f.request)));
  assert.equal(race.filter(result => result.status === "fulfilled").length, 1);
});

test("recovery rejects controller ambiguity, migration, switch, acceptance, mode and active-service conflicts", async t => {
  const f = await fixture(t);
  await assert.rejects(runBootstrap({ requestPath: f.requestPath, sourceRoot: f.root,
    updateSource: async () => { throw new Error("source invalid"); } }));
  const safe = await f.read(f.latestPath);
  // An interrupted read-only bootstrap phase is safe only with the same affirmative evidence
  // and an inactive service; elapsed time alone is never consulted.
  assertEarlyRequestRecoverable({ request: f.request, latest: { ...safe, result: "BOOTSTRAP_RUNNING" }, mode: "deploy" });
  for (const patch of [{ migrationMayHaveChanged: true }, { migrationState: "STARTED_OR_UNKNOWN" },
    { webSwitch: "SWITCH_STARTED" }, { workerSwitch: "TARGET_RECREATED" }, { applicationAccepted: true },
    { result: "CONTROL_PLANE_FINALIZATION_FAILED" }, { controllerStarted: true }, { attempts: [] }]) {
    assert.throws(() => assertEarlyRequestRecoverable({ request: f.request, latest: { ...safe, ...patch }, mode: "deploy" }));
  }
  assert.throws(() => assertEarlyRequestRecoverable({ request: f.request, latest: safe, mode: "rollback" }));
  assert.throws(() => assertEarlyRequestRecoverable({ request: f.request, latest: safe, mode: "deploy", serviceActive: true }));
});

test("Git retries transient fetch only, classifies permanent errors, never repeats fast-forward", async () => {
  for (const [text, code] of [["Authentication failed https://private.example.test", "BOOTSTRAP_GIT_AUTH_FAILED"],
    ["SSL certificate problem", "BOOTSTRAP_GIT_TLS_FAILED"], ["unknown failure", "BOOTSTRAP_GIT_FETCH_FAILED"]]) {
    let calls = 0;
    await assert.rejects(fetchWithRetry(async () => { calls++; throw new Error(text); }, { delay: async () => {} }), new RegExp(code));
    assert.equal(calls, 1);
  }
  assert.equal(classifyGitFailure(new Error("secret"), { operation: "fast-forward" }).code, "BOOTSTRAP_GIT_FAST_FORWARD_FAILED");
});

test("forward schema compatibility uses checksum identity, never ordering; migration uncertainty blocks rollback", () => {
  const before = manifest(1), after = manifest(2);
  assert.equal(applicationRollbackDecision({ migrationState: "NOT_STARTED", database: before, previousImageSchema: before }).status, "REQUIRED");
  assert.equal(applicationRollbackDecision({ migrationState: "COMPLETED", database: after, previousImageSchema: before }).status, "UNSAFE");
  assert.equal(applicationRollbackDecision({ migrationState: "STARTED_OR_UNKNOWN", database: before, previousImageSchema: before }).status, "UNSAFE");
  assert.equal(schemasMatch(after, { ...after, digest: "f".repeat(64) }), false);
});

test("database evidence is authoritative, transactionally read-only, and errors redact connection data", async () => {
  const calls = [];
  const database = await readDatabaseSchema({ query: async sql => {
    calls.push(sql); return sql.includes("to_regclass") ? { rows: [{ ledger: "app_meta.schema_migrations" }] }
      : sql.startsWith("select name") ? { rows: [{ name: "001_example.sql", checksum: "0".repeat(64) }] } : {};
  } });
  assert.equal(database.head, "001_example.sql"); assert.match(calls[0], /READ ONLY/); assert.equal(calls.at(-1), "COMMIT");
  await assert.rejects(readDatabaseSchema({ query: async sql => {
    if (sql.startsWith("BEGIN") || sql === "ROLLBACK") return {};
    throw new Error("postgresql://fiction:private@db.example.test/data");
  } }), /^Error: DATABASE_SCHEMA_EVIDENCE_UNAVAILABLE$/);
});

test("public readiness retries real local HTTP 530 then validates exact-version 200", async t => {
  let requests = 0;
  const server = createServer((_, response) => {
    requests++; response.statusCode = requests < 3 ? 530 : 200;
    response.end(JSON.stringify({ status: "ok", version: "1.0.1" }));
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const result = await waitForPublicEdge({ url: `http://127.0.0.1:${server.address().port}`, expectedVersion: "1.0.1", sleep: async () => {} });
  assert.equal(result.attempts, 3);
});

for (const [label, response, expected, attempts] of [
  ["persistent 530", () => new Response("", { status: 530 }), "PUBLIC_EDGE_HTTP_530", 3],
  ["wrong version", () => Response.json({ status: "ok", version: "0.9.0" }), "PUBLIC_EDGE_VERSION_MISMATCH", 1],
  ["invalid JSON", () => new Response("not json"), "PUBLIC_EDGE_RESPONSE_INVALID", 1],
  ["TLS", () => { throw Object.assign(new Error("private"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }); }, "PUBLIC_EDGE_TLS_FAILED", 3],
  ["DNS", () => { throw Object.assign(new Error("private"), { code: "ENOTFOUND" }); }, "PUBLIC_EDGE_DNS_FAILED", 3],
  ["reset", () => { throw Object.assign(new Error("private"), { code: "ECONNRESET" }); }, "PUBLIC_EDGE_CONNECTION_RESET", 3],
  ["timeout", () => { throw Object.assign(new Error("private"), { name: "TimeoutError" }); }, "PUBLIC_EDGE_TIMEOUT", 3],
]) test(`public acceptance rejects ${label} with bounded attempts and sanitized error`, async () => {
  let calls = 0;
  await assert.rejects(waitForPublicEdge({ url: "https://app.example.test/api/health", expectedVersion: "1.0.1",
    maxAttempts: 3, sleep: async () => {}, fetchResponse: async () => { calls++; return response(); } }), new RegExp(`^Error: ${expected}$`));
  assert.equal(calls, attempts);
});

test("healthy forward target with edge outage stays pending; acceptance continuation never rebuilds/migrates", async () => {
  const latest = { result: "PUBLIC_EDGE_RECOVERY_REQUIRED", requestId, mode: "deploy", targetCommit: b,
    internalReleaseHealth: "HEALTHY", migrationState: "COMPLETED", migrationMayHaveChanged: true,
    applicationAccepted: false, finalizationComplete: false, requestArchived: false };
  assert.equal(deploymentFailureDisposition({ ...latest, publicEdgeFailure: true, rollback: { status: "UNSAFE" } }), latest.result);
  const calls = [], request = { requestId, mode: "deploy" };
  await resumeCandidateAcceptance({ request, latest, operations: {
    validateIdentity: async () => { calls.push("identity-schema-image"); return {}; },
    acceptRuntime: async () => { calls.push("internal-public"); return {}; },
    finalize: async () => { calls.push("accept-archive"); },
  } });
  assert.deepEqual(calls, ["identity-schema-image", "internal-public", "accept-archive"]);
  assert.throws(() => assertPendingAcceptance({ request: { ...request, requestId: "stale" }, latest }));
  let finalized = false;
  await assert.rejects(resumeCandidateAcceptance({ request, latest, operations: {
    validateIdentity: async () => ({}), acceptRuntime: async () => { throw new Error("WORKER_SCHEMA_NOT_CURRENT"); },
    finalize: () => { finalized = true; },
  } }), /WORKER_SCHEMA_NOT_CURRENT/);
  assert.equal(finalized, false);
});

test("every workflow boundary preserves conservative migration/switch intent", async t => {
  const phases = ["resolveTarget", "preflightSecretSources", "preflightTargetRuntimeContract", "prepare", "buildImages",
    "writeCandidateEnvironment", "startPostgres", "verifyMigrations", "captureSchemaBefore", "captureReleaseHealthBaseline",
    "markMigrationMayHaveChanged", "migrate", "captureSchemaAfter", "switchApplication", "acceptRuntime"];
  for (const failure of phases) await t.test(failure, async () => {
    const calls = [];
    const operations = Object.fromEntries(phases.map(phase => [phase, async () => {
      calls.push(phase); if (phase === failure) throw new Error("simulated interruption"); return {};
    }]));
    await assert.rejects(runProductionReleaseWorkflow({ mode: "deploy", targetCommit: b, operations }), error => {
      assert.equal(error.migrationMayHaveChanged, phases.indexOf(failure) >= phases.indexOf("markMigrationMayHaveChanged"));
      assert.equal(error.switched, phases.indexOf(failure) >= phases.indexOf("switchApplication"));
      return true;
    });
    assert.equal(calls.at(-1), failure);
  });
});

test("terminal archive faults reconcile once without application replay, including interrupted writes", async t => {
  for (const boundary of ["status-before", "archive", "status-after", "latest"]) await t.test(boundary, async tt => {
    const f = await fixture(tt), statusPath = path.join(f.root, "state/status.json"), archive = path.join(f.root, "state/archive.json");
    let writes = 0, renames = 0, injected = false;
    const atomicWrite = (file, contents) => {
      writes++;
      if (!injected && ((boundary === "status-before" && writes === 1) || (boundary === "status-after" && writes === 2)
        || (boundary === "latest" && file === f.latestPath))) { injected = true; throw new Error("disk fault"); }
      durableDeploymentWrite(file, contents);
    };
    assert.throws(() => finalizeTerminalDeployment({ currentState: { requestId, mode: "deploy", deploymentId: "fixture" },
      result: "SUCCESS", startedAt: new Date(), requestPath: f.requestPath, requestArchivePath: archive,
      statusPath, latestPath: f.latestPath, exists: existsSync, atomicWrite,
      rename: (from, to) => { if (boundary === "archive") throw new Error("archive fault"); renames++; renameSync(from, to); } }), /CONTROL_PLANE_FINALIZATION_FAILED/);
    const state = await f.read(statusPath), latest = await f.read(f.latestPath);
    const options = { state, latest, requestPath: f.requestPath, requestArchivePath: archive, statusPath, latestPath: f.latestPath,
      readJson: file => existsSync(file) ? JSON.parse(requireRead(file)) : null, exists: existsSync,
      rename: (from, to) => { renames++; renameSync(from, to); }, atomicWrite: durableDeploymentWrite };
    const result = reconcileTerminalDeployment(options);
    reconcileTerminalDeployment({ ...options, state: result, latest: result });
    assert.equal(renames, 1); assert.equal(result.finalizationComplete, true);
  });
});

test("Node diagnostics reject 26 before caller side effects and accept pinned LTS", () => {
  assert.throws(() => assertDeploymentRuntime("v26.10.0"), /HOST_NODE_VERSION=v26.10.0.*REQUIRED_NODE_VERSION=.*COMPATIBILITY_RESULT=INCOMPATIBLE/);
  assert.equal(assertDeploymentRuntime("v24.22.0").COMPATIBILITY_RESULT, "COMPATIBLE");
});

test("crash after accepted record but before terminal journal can reconcile without replay", () => {
  const state = { requestId, mode: "deploy", targetCommit: b, targetImage: `example:${b}`, applicationVersion: "1.0.1",
    finalReleaseAcceptance: "VERIFIED", internalReleaseHealth: "HEALTHY", result: "RUNNING", stage: "public-health" };
  const accepted = { requestId, mode: "deploy", commit: b, currentImage: `example:${b}`, version: "1.0.1" };
  assert.equal(terminalReconciliationEvidence({ state, accepted, requestArchivePath: "/example/archive.json" }).applicationResult, "SUCCESS");
  assert.throws(() => terminalReconciliationEvidence({ state: { ...state, finalReleaseAcceptance: "PENDING" }, accepted }));
  assert.throws(() => terminalReconciliationEvidence({ state, accepted: { ...accepted, commit: a } }));
});

test("forward deployment preserves disk candidate on 530 and resumes exactly once without rebuild or migration", async t => {
  const f = await fixture(t);
  const acceptedPath = path.join(f.root, "state/accepted.json");
  const statusPath = path.join(f.root, "state/controller.json");
  const archivePath = path.join(f.root, "state/archive.json");
  const old = { commit: a, image: `example:${a}`, version: "1.0.0" };
  await writeFile(acceptedPath, JSON.stringify(old));
  let database = manifest(1), runtime = old, builds = 0, migrations = 0, switches = 0, online = false;
  const target = { commit: b, image: `example:${b}`, version: "1.0.1" };
  let state = { deploymentId: "fixture", requestId, mode: "deploy", applicationAccepted: false,
    finalizationComplete: false, requestArchived: false, migrationState: "NOT_STARTED", internalReleaseHealth: "UNVERIFIED" };
  const persist = patch => { state = { ...state, ...patch }; durableDeploymentWrite(statusPath, JSON.stringify(state)); durableDeploymentWrite(f.latestPath, JSON.stringify(state)); };
  const health = async () => {
    assert.equal(runtime.image, target.image); assert.equal(schemasMatch(database, manifest(2)), true);
    persist({ internalReleaseHealth: "HEALTHY" });
    return waitForPublicEdge({ url: "https://app.example.test/api/health", expectedVersion: target.version,
      maxAttempts: 2, sleep: async () => {}, fetchResponse: async () => online
        ? Response.json({ status: "ok", version: target.version }) : new Response("", { status: 530 }) });
  };
  try {
    await runProductionReleaseWorkflow({ mode: "deploy", targetCommit: b, operations: {
      resolveTarget: async () => { persist({ targetCommit: b, targetImage: target.image, applicationVersion: target.version }); return target; },
      preflightSecretSources: async () => {}, preflightTargetRuntimeContract: async () => {}, prepare: async () => {},
      buildImages: async () => { builds++; }, writeCandidateEnvironment: async () => "candidate", startPostgres: async () => {},
      verifyMigrations: async () => {}, captureSchemaBefore: async () => persist({ schemaBefore: database }), captureReleaseHealthBaseline: async () => ({}),
      markMigrationMayHaveChanged: async () => persist({ migrationState: "STARTED_OR_UNKNOWN", migrationMayHaveChanged: true }),
      migrate: async () => { migrations++; database = manifest(2); }, captureSchemaAfter: async () => persist({ migrationState: "COMPLETED", schemaAfter: database }),
      switchApplication: async () => { switches++; runtime = target; }, acceptRuntime: health,
    } });
    assert.fail("public failure must not accept");
  } catch (error) {
    const rollback = applicationRollbackDecision({ migrationState: state.migrationState, database, previousImageSchema: manifest(1) });
    persist({ result: deploymentFailureDisposition({ ...state, publicEdgeFailure: error.cause?.publicEdgeFailure, rollback }) });
  }
  assert.equal((await f.read(f.latestPath)).result, "PUBLIC_EDGE_RECOVERY_REQUIRED");
  assert.deepEqual(await f.read(acceptedPath), old); assert.equal(runtime.image, target.image); assert.equal(existsSync(f.requestPath), true);
  online = true;
  await resumeCandidateAcceptance({ request: f.request, latest: await f.read(f.latestPath), operations: {
    validateIdentity: async latest => { assert.equal(latest.targetCommit, b); return target; }, acceptRuntime: health,
    finalize: async () => {
      durableDeploymentWrite(acceptedPath, JSON.stringify(target));
      finalizeTerminalDeployment({ currentState: state, result: "SUCCESS", startedAt: new Date(),
        requestPath: f.requestPath, requestArchivePath: archivePath, statusPath, latestPath: f.latestPath,
        exists: existsSync, rename: renameSync, atomicWrite: durableDeploymentWrite });
    },
  } });
  assert.equal(builds, 1); assert.equal(migrations, 1); assert.equal(switches, 1);
  assert.equal((await f.read(acceptedPath)).commit, b);
  assert.equal((await f.read(archivePath)).requestId, requestId);
  assert.equal((await f.read(f.latestPath)).result, "SUCCESS");
});

test("Tunnel diagnostics follows service PID socket ownership across changing ports, zero connections means disconnected", async () => {
  for (const port of [20241, 20244]) {
    const report = await diagnoseTunnel({ expectedTunnelId: requestId,
      command: async (_, args) => args.includes("--value") ? "42\n" : args[0] === "show"
        ? "ActiveState=active\nSubState=running\nNRestarts=1501\nMainPID=42\nUser=cloudflared-lumina"
        : `tunnelID=${requestId} TLS handshake EOF private-token`,
      read: async file => file.endsWith("cgroup") ? "0::/system.slice/cloudflared-lumina.service"
        : ` 0: 0100007F:${port.toString(16)} 00000000:0000 0A 0 0 0 1001 0 12345\n`,
      list: async () => ["3"], link: async file => file.endsWith("exe") ? "/usr/local/bin/cloudflared" : "socket:[12345]",
      fetchResponse: async url => { assert.equal(url, `http://127.0.0.1:${port}/metrics`); return new Response("cloudflared_tunnel_ha_connections 0\n"); },
    });
    assert.equal(report.connectionState, "DISCONNECTED"); assert.equal(report.registeredEdgeConnections, 0);
    assert.equal(report.tunnelId, requestId); assert.equal(report.recentError, "TUNNEL_TLS_FAILED");
    assert.doesNotMatch(JSON.stringify(report), /private-token/);
  }
});

// Sync reads are used only by the injected filesystem finalizer.
import { readFileSync as requireRead } from "node:fs";
