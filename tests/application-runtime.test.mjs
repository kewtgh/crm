import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyWorkerProcessStderr,
  workerProcessFailure,
} from "../scripts/lib/worker-process-diagnostics.mjs";
import { APPLICATION_RUNTIME_ENTRYPOINTS, verifyApplicationRuntimeClosure } from "../scripts/verify-application-runtime-closure.mjs";

const repositoryRoot = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1"));

async function applicationRuntimeFixture(context) {
  const fixture = await mkdtemp(path.join(tmpdir(), "lumina-application-copy-"));
  assert.ok(path.resolve(fixture).startsWith(`${path.resolve(tmpdir())}${path.sep}`));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  const dockerfile = await readFile(path.join(repositoryRoot, "Dockerfile"), "utf8");
  const stage = dockerfile.slice(dockerfile.indexOf("FROM ${NODE_IMAGE} AS application"),
    dockerfile.indexOf("FROM ${POSTGRES_IMAGE} AS operations"));
  const logicalLines = stage.replace(/\\\r?\n\s*/g, " ").split(/\r?\n/);
  const copied = [];
  for (const line of logicalLines.filter((line) => line.startsWith("COPY ") && !line.includes("--from="))) {
    const words = line.split(/\s+/).slice(1).filter((word) => !word.startsWith("--"));
    const destination = words.pop();
    for (const source of words.filter((word) => /^(?:lib|scripts)\//.test(word))) {
      assert.match(source, /\.mjs$/);
      assert.match(line, /^COPY --chown=lumina:lumina /);
      const relative = path.posix.join(destination, path.posix.basename(source));
      assert.equal(relative, source, "fixture mirrors the actual application COPY destination");
      const target = path.join(fixture, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(repositoryRoot, source), target);
      copied.push(relative);
    }
  }
  assert.ok(copied.length >= APPLICATION_RUNTIME_ENTRYPOINTS.length);
  return fixture;
}

const verifyFixture = (root) => verifyApplicationRuntimeClosure({ root, enforceImageIdentity: false });

test("final application COPY fixture includes the complete recursive entrypoint closure", async (context) => {
  const fixture = await applicationRuntimeFixture(context);
  const result = await verifyFixture(fixture);
  for (const entrypoint of APPLICATION_RUNTIME_ENTRYPOINTS) assert.ok(result.modules.includes(entrypoint));
  assert.ok(result.modules.includes("scripts/lib/contract-extraction-thread.mjs"));
  const privacyImports = result.imports.filter(({ module, importedBy }) =>
    importedBy === "scripts/process-generated-jobs.mjs" && /\/[^/]+-privacy-export\.mjs$/.test(module));
  assert.equal(privacyImports.length, 9);
  for (const { module } of privacyImports) assert.ok(result.modules.includes(module));
});

test("omitting any generated-job privacy import fails the recursive application gate", async (context) => {
  const fixture = await applicationRuntimeFixture(context);
  const result = await verifyFixture(fixture);
  const privacyImports = result.imports.filter(({ module, importedBy }) =>
    importedBy === "scripts/process-generated-jobs.mjs" && /\/[^/]+-privacy-export\.mjs$/.test(module));
  assert.equal(privacyImports.length, 9);
  for (const { module } of privacyImports) {
    await context.test(module, async () => {
      await rm(path.join(fixture, module));
      try {
        await assert.rejects(verifyFixture(fixture), (error) =>
          error.code === "APPLICATION_RUNTIME_MODULE_MISSING"
          && error.missingModules.length === 1 && error.missingModules[0].module === module);
      } finally {
        await cp(path.join(repositoryRoot, module), path.join(fixture, module));
      }
    });
  }
  for (const { module } of privacyImports) await rm(path.join(fixture, module));
  await assert.rejects(verifyFixture(fixture), (error) => {
    assert.equal(error.code, "APPLICATION_RUNTIME_MODULE_MISSING");
    assert.deepEqual(error.missingModules.map((item) => item.module).sort(),
      privacyImports.map((item) => item.module).sort());
    return true;
  });
});

test("application gate checks module URLs used by extraction worker threads", async (context) => {
  const fixture = await applicationRuntimeFixture(context);
  await rm(path.join(fixture, "scripts/lib/contract-extraction-thread.mjs"));
  await assert.rejects(verifyFixture(fixture), (error) =>
    error.code === "APPLICATION_RUNTIME_MODULE_MISSING"
    && error.missingModules.some(({ module }) => module === "scripts/lib/contract-extraction-thread.mjs"));
});

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
  assert.match(applicationStage, /scripts\/lib\/worker-container-health\.mjs/);
  assert.match(applicationStage, /scripts\/lib\/worker-process-diagnostics\.mjs/);
  assert.ok(
    applicationStage.indexOf("USER 10001:10001")
      < applicationStage.indexOf("RUN node scripts/verify-application-runtime-closure.mjs"),
  );
  assert.doesNotMatch(applicationStage, /COPY(?:[^\n]*\\\r?\n)*[^\n]*\blib\s+\.\/lib/);
  assert.doesNotMatch(applicationStage, /COPY\s+\.\s+\./);
  assert.doesNotMatch(applicationStage, /COPY(?:[^\n]*\\\r?\n)*[^\n]*\bdocs(?:\/|\s|$)/);
});

test("operations inherits Node system dependencies and verifies its final runtime", async () => {
  const dockerfile = await readFile(path.join(repositoryRoot, "Dockerfile"), "utf8");
  const operationsStage = dockerfile.slice(dockerfile.indexOf("FROM ${POSTGRES_IMAGE} AS operations"));
  assert.match(operationsStage, /COPY --from=application \/usr\/local \/usr\/local/);
  assert.match(operationsStage, /COPY --from=application \/usr\/lib\/\*-linux-gnu\/libatomic\.so\.1\.\* \/usr\/local\/lib\//);
  assert.ok(operationsStage.indexOf("libatomic.so.1.*") < operationsStage.indexOf("RUN ldconfig"));
  assert.match(operationsStage, /COPY --from=application --chown=lumina:lumina \/app \/app/);
  assert.ok(operationsStage.indexOf("USER 10001:10001")
    < operationsStage.indexOf("RUN node scripts/verify-application-runtime-closure.mjs"));
  assert.match(operationsStage, /RUN node scripts\/verify-application-runtime-closure\.mjs/);
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
