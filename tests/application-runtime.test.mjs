import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyWorkerProcessStderr,
  workerProcessFailure,
} from "../scripts/lib/worker-process-diagnostics.mjs";
import { verifyApplicationRuntimeClosure } from "../scripts/verify-application-runtime-closure.mjs";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));

test("application runtime closure resolves every production entrypoint", async () => {
  const result = await verifyApplicationRuntimeClosure({
    root: repositoryRoot,
    enforceImageIdentity: false,
  });
  assert.ok(result.checkedModules >= 20);
  assert.equal(result.invitationModule, "readable-and-importable");
});

test("application runtime closure fails when the Outbox crypto dependency is absent", async (context) => {
  const fixture = await mkdtemp(path.join(tmpdir(), "lumina-runtime-closure-"));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  const files = [
    "scripts/process-notification-outbox.mjs",
    "scripts/worker-heartbeat.mjs",
    "scripts/lib/bounded-concurrency.mjs",
    "scripts/lib/delivery-webhook.mjs",
    "scripts/lib/notification-delivery-protocol.mjs",
    "scripts/lib/worker-database.mjs",
  ];
  for (const relativePath of files) {
    const destination = path.join(fixture, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(repositoryRoot, relativePath), destination);
  }

  await assert.rejects(
    verifyApplicationRuntimeClosure({
      root: fixture,
      entrypoints: ["scripts/process-notification-outbox.mjs"],
      enforceImageIdentity: false,
      importInvitationModule: false,
    }),
    (error) => error?.code === "APPLICATION_RUNTIME_MODULE_MISSING"
      && /lib\/invitation-credential-crypto\.mjs/.test(error.message),
  );
});

test("Docker application stage runs the closure gate after minimal owned copies", async () => {
  const dockerfile = await readFile(path.join(repositoryRoot, "Dockerfile"), "utf8");
  const applicationStage = dockerfile.slice(
    dockerfile.indexOf("FROM ${NODE_IMAGE} AS application"),
    dockerfile.indexOf("FROM ${POSTGRES_IMAGE} AS operations"),
  );
  assert.match(applicationStage, /lib\/invitation-credential-crypto\.mjs/);
  assert.match(applicationStage, /scripts\/verify-application-runtime-closure\.mjs/);
  assert.match(applicationStage, /scripts\/lib\/notification-delivery-protocol\.mjs/);
  assert.match(applicationStage, /scripts\/lib\/worker-process-diagnostics\.mjs/);
  assert.ok(
    applicationStage.indexOf("USER 10001:10001")
      < applicationStage.indexOf("RUN node scripts/verify-application-runtime-closure.mjs"),
  );
  assert.doesNotMatch(applicationStage, /COPY(?:[^\n]*\\\r?\n)*[^\n]*\blib\s+\.\/lib/);
  assert.doesNotMatch(applicationStage, /COPY\s+\.\s+\./);
});

test("missing worker modules use a bounded safe classification", () => {
  const secretUrl = "postgresql://user:password@database.example.test/lumina";
  const secretToken = "temporary-password-secret-token";
  const stderr = [
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/app/lib/missing.mjs'",
    secretUrl,
    secretToken,
    "recipient@example.test",
    "x".repeat(5000),
  ].join("\n");
  const result = workerProcessFailure("process-notification-outbox.mjs", stderr);
  assert.equal(result.errorCode, "WORKER_RUNTIME_MODULE_MISSING");
  assert.equal(result.error.message, "WORKER_RUNTIME_MODULE_MISSING:process-notification-outbox.mjs");
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    secretUrl,
    secretToken,
    "recipient@example.test",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("ordinary worker exits remain distinct from module resolution failures", () => {
  assert.equal(classifyWorkerProcessStderr("operation failed"), "WORKER_PROCESS_EXITED");
});
