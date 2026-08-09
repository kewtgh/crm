import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runBootstrap,
  spawnTargetController,
  targetControllerArguments,
  updateSourceAndResolveTarget,
} from "../scripts/deploy-production-bootstrap.mjs";
import {
  buildkitCleanupArguments,
  nonNegativeReclaimedBytes,
  parsePostDeploymentCleanupPolicy,
  performPostDeploymentCleanup,
  selectHistoryCleanupCandidates,
  selectLuminaImageDeletionCandidates,
} from "../scripts/lib/post-deployment-cleanup.mjs";
import {
  parseTargetControllerArguments,
  verifyTargetControllerSource,
} from "../scripts/lib/target-controller-source.mjs";

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const commit = (character) => character.repeat(40);
const imageId = (number) => `sha256:${number.toString(16).padStart(64, "0")}`;
const DAY_MS = 24 * 60 * 60 * 1_000;

function image({ id, revision, kind = "application", created, repository = "kewtgh/crm", managed = "true", tag }) {
  return {
    Id: imageId(id),
    Created: created,
    Size: 100 + id,
    RepoTags: [tag ?? `lumina-${kind}:${revision}`],
    Config: {
      Labels: {
        "com.lumina.crm.managed": managed,
        "com.lumina.crm.repository": repository,
        "org.opencontainers.image.revision": revision,
        ...(kind === "operations" ? { "com.lumina.crm.image-kind": "operations" } : {}),
      },
    },
  };
}

function releaseImages(character, ordinal) {
  const revision = commit(character);
  const created = new Date(Date.UTC(2026, 0, ordinal)).toISOString();
  return [
    image({ id: ordinal * 2, revision, created, tag: `lumina-crm:${revision}` }),
    image({ id: ordinal * 2 + 1, revision, kind: "operations", created, tag: `lumina-crm-ops:${revision}` }),
  ];
}

test("bootstrap fetches and fast-forwards a clean allowed production source exactly once", async () => {
  const calls = [];
  let statusCalls = 0;
  let merged = false;
  const git = async (args, options = {}) => {
    calls.push({ args, options });
    if (args[0] === "branch") return "main";
    if (args[0] === "remote") return "git@github.com:kewtgh/crm.git";
    if (args[0] === "status") return statusCalls++ ? "" : "";
    if (args[0] === "rev-parse" && args[1] === "HEAD") return merged ? commit("b") : commit("a");
    if (args[0] === "rev-parse") return commit("b");
    if (args[0] === "merge") { merged = true; return ""; }
    return "";
  };
  const result = await updateSourceAndResolveTarget({ git, environment: { SECRET: "untouched" } });
  assert.deepEqual(result, { bootstrapCommit: commit("a"), targetCommit: commit("b") });
  assert.equal(calls.filter(({ args }) => args[0] === "fetch").length, 1);
  assert.equal(calls.some(({ args }) => args[0] === "merge" && args.at(-1) === commit("b")), true);
});

test("target controller launch requires source-updated protocol, full SHAs, and a distinct PID", () => {
  const args = targetControllerArguments(commit("b"), commit("a"));
  const parsed = parseTargetControllerArguments(args, process.pid + 1);
  assert.equal(parsed.expectedTarget, commit("b"));
  assert.equal(parsed.bootstrapSource, commit("a"));
  assert.throws(
    () => parseTargetControllerArguments(["--source-already-updated", "--expected-target=short"], process.pid),
    /TARGET_CONTROLLER_SOURCE_CHANGED/,
  );
});

test("target controller TOCTOU verification fails closed before release work", async () => {
  const launch = { expectedTarget: commit("b"), bootstrapSource: commit("a"), bootstrapPid: 10 };
  const values = new Map([
    ["branch", "main"], ["remote", "git@github.com:kewtgh/crm.git"],
    ["rev-parse", commit("b")], ["status", ""],
  ]);
  const verify = (overrides = {}) => verifyTargetControllerSource({
    launch,
    git: async (args) => overrides[args[0]] ?? values.get(args[0]),
    readPackageVersion: () => overrides.version ?? "3.8.26",
    allowedOrigins: new Set(["git@github.com:kewtgh/crm.git"]),
  });
  assert.deepEqual(await verify(), { commit: commit("b"), version: "3.8.26" });
  for (const mismatch of [
    { "rev-parse": commit("c") }, { status: " M runner" },
    { branch: "feature" }, { remote: "git@example.invalid/other.git" }, { version: "invalid" },
  ]) await assert.rejects(verify(mismatch), /TARGET_CONTROLLER_SOURCE_CHANGED/);
});

test("3.8.24 bootstrap reloads the 3.8.25 target controller and bypasses both old-runner defects", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lumina-generation-boundary-"));
  const scripts = path.join(directory, "scripts");
  const state = path.join(directory, "state");
  const requestPath = path.join(state, "request.json");
  const evidencePath = path.join(directory, "evidence.json");
  await mkdir(scripts, { recursive: true });
  await mkdir(state, { recursive: true });
  await writeFile(path.join(directory, "package.json"), '{"version":"3.8.25"}\n');
  await writeFile(path.join(scripts, "deploy-production-runner.mjs"), [
    'throw new Error("OLD_RUNNER_SENTINEL");',
    'throw new Error("initialRuntime is not defined");',
  ].join("\n"));
  await writeFile(requestPath, `${JSON.stringify({
    requestId: "12345678-1234-1234-1234-123456789abc",
    mode: "deploy",
    sourceRoot: directory,
  })}\n`);
  try {
    const exitCode = await runBootstrap({
      requestPath,
      sourceRoot: directory,
      updateSource: async () => {
        await writeFile(path.join(scripts, "deploy-production-runner.mjs"), [
          'import { writeFileSync } from "node:fs";',
          'writeFileSync(process.env.FIXTURE_EVIDENCE, JSON.stringify({',
          '  pid: process.pid, source: "RELEASE_B", args: process.argv.slice(2),',
          '  sourceVersionBefore: "3.8.24", runtimeBefore: "3.8.24", databaseMigrationBefore: "073",',
          '  targetVersion: "3.8.25", runtimeAfter: "3.8.25", databaseMigrationsAlreadyCurrent: 78,',
          '  workflow: ["build", "migration", "switch", "acceptance", "cleanup", "archive", "finalization"],',
          '  rollback: false, requestArchived: true, finalizationComplete: true, latestResult: "SUCCESS"',
          '}));',
        ].join("\n"));
        return { bootstrapCommit: commit("a"), targetCommit: commit("b") };
      },
      spawnController: (options) => spawnTargetController({
        ...options,
        nodePath: process.execPath,
        environment: { ...process.env, FIXTURE_EVIDENCE: evidencePath },
      }),
    });
    assert.equal(exitCode, 0);
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    assert.notEqual(evidence.pid, process.pid);
    assert.equal(evidence.source, "RELEASE_B");
    assert.equal(evidence.sourceVersionBefore, "3.8.24");
    assert.equal(evidence.runtimeBefore, "3.8.24");
    assert.equal(evidence.databaseMigrationBefore, "073");
    assert.equal(evidence.targetVersion, "3.8.25");
    assert.equal(evidence.runtimeAfter, "3.8.25");
    assert.equal(evidence.databaseMigrationsAlreadyCurrent, 78);
    assert.deepEqual(evidence.workflow, ["build", "migration", "switch", "acceptance", "cleanup", "archive", "finalization"]);
    assert.equal(evidence.rollback, false);
    assert.equal(evidence.requestArchived, true);
    assert.equal(evidence.finalizationComplete, true);
    assert.equal(evidence.latestResult, "SUCCESS");
    assert.equal(evidence.args.some((arg) => arg === `--expected-target=${commit("b")}`), true);
    assert.doesNotMatch(JSON.stringify(evidence), /OLD_RUNNER_SENTINEL|initialRuntime is not defined/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a target controller start failure records a control-plane failure before build or migration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lumina-controller-failure-"));
  const scripts = path.join(directory, "scripts");
  const state = path.join(directory, "state");
  const requestPath = path.join(state, "request.json");
  await mkdir(scripts, { recursive: true });
  await mkdir(state, { recursive: true });
  await writeFile(path.join(directory, "package.json"), '{"version":"3.8.26"}\n');
  await writeFile(path.join(scripts, "deploy-production-runner.mjs"), "process.exitCode = 1;\n");
  await writeFile(requestPath, `${JSON.stringify({
    requestId: "12345678-1234-1234-1234-123456789abc", mode: "deploy", sourceRoot: directory,
  })}\n`);
  await writeFile(path.join(state, "latest.json"), `${JSON.stringify({
    requestId: "12345678-1234-1234-1234-123456789abc",
    result: "RUNNING",
    stage: "stale-old-controller",
  })}\n`);
  try {
    const code = await runBootstrap({
      requestPath,
      sourceRoot: directory,
      updateSource: async () => ({ bootstrapCommit: commit("a"), targetCommit: commit("b") }),
      spawnController: async () => ({ code: 1, pid: 999 }),
    });
    assert.equal(code, 1);
    const latest = JSON.parse(await readFile(path.join(state, "latest.json"), "utf8"));
    assert.equal(latest.result, "CONTROL_PLANE_FINALIZATION_FAILED");
    assert.equal(latest.applicationResult, "NOT_STARTED");
    assert.equal(latest.error, "TARGET_CONTROLLER_EXIT_FAILED");
    assert.equal(await readFile(requestPath, "utf8").then(Boolean), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cleanup policy defaults are bounded and invalid values fail closed", () => {
  const policy = parsePostDeploymentCleanupPolicy({});
  assert.equal(policy.imageReleasesToKeep, 3);
  assert.equal(policy.historyMinimumKeep, 20);
  assert.deepEqual(buildkitCleanupArguments(policy), [
    "buildx", "--builder", "lumina-crm-buildkit", "prune",
    "--filter", "until=168h", "--max-used-space", "12GB",
    "--reserved-space", "2GB", "--force",
  ]);
  assert.throws(() => parsePostDeploymentCleanupPolicy({ LUMINA_IMAGE_RELEASES_TO_KEEP: "2" }), /INVALID/);
  assert.throws(() => parsePostDeploymentCleanupPolicy({ LUMINA_BUILDKIT_MAX_USED_SPACE: "all" }), /INVALID/);
  assert.throws(() => parsePostDeploymentCleanupPolicy({
    LUMINA_BUILDKIT_MAX_USED_SPACE: "2GB",
    LUMINA_BUILDKIT_RESERVED_SPACE: "2GB",
  }), /STORAGE_LIMITS_INVALID/);
});

test("invalid cleanup configuration becomes a stable non-fatal result without Docker access", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lumina-cleanup-config-"));
  const logRoot = path.join(directory, "logs");
  await mkdir(logRoot);
  try {
    const result = await performPostDeploymentCleanup({
      accepted: {}, target: {}, currentDeploymentId: "current", stateRoot: directory, logRoot,
      environment: { LUMINA_IMAGE_RELEASES_TO_KEEP: "2" },
      snapshot: () => ({ totalBytes: 100, availableBytes: 50, usedPercentage: 50 }),
      runDocker: async () => { throw new Error("Docker must not run"); },
    });
    assert.equal(result.status, "FAILED_NON_FATAL");
    assert.deepEqual(result.warnings, ["CLEANUP_CONFIGURATION_INVALID"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("image retention deletes only complete old Lumina pairs and isolates foreign and HunterAI images", () => {
  const releases = [
    ...releaseImages("a", 1), ...releaseImages("b", 2),
    ...releaseImages("c", 3), ...releaseImages("d", 4),
  ];
  const foreign = image({ id: 20, revision: commit("e"), created: "2026-01-01T00:00:00Z", repository: "hunterai/project" });
  const unknown = image({ id: 21, revision: commit("f"), created: "2026-01-01T00:00:00Z", managed: "false" });
  const candidates = selectLuminaImageDeletionCandidates([...releases, foreign, unknown], { releasesToKeep: 3 });
  assert.deepEqual(candidates.map((candidate) => candidate.commit), [commit("a"), commit("a")]);
  assert.equal(candidates.some((candidate) => candidate.id === foreign.Id || candidate.id === unknown.Id), false);
});

test("running, current, rollback, recent, target, and incomplete releases are permanently protected", () => {
  const releases = [
    ...releaseImages("a", 1), ...releaseImages("b", 2),
    ...releaseImages("c", 3), ...releaseImages("d", 4), ...releaseImages("e", 5),
  ];
  const incomplete = releaseImages("f", 0)[0];
  const protectedReferences = new Set([
    releases[0].RepoTags[0], releases[2].RepoTags[0], releases[4].RepoTags[0], releases[6].RepoTags[0],
  ]);
  const candidates = selectLuminaImageDeletionCandidates([...releases, incomplete], {
    releasesToKeep: 3,
    protectedReferences,
    inUseImageIds: new Set([releases[1].Id]),
  });
  assert.deepEqual(candidates, []);
});

test("history deletion requires both age and minimum-count limits and protects referenced deployments", () => {
  const nowMs = Date.parse("2026-08-09T00:00:00Z");
  const entries = Array.from({ length: 25 }, (_, index) => {
    const id = `202601${String(index + 1).padStart(2, "0")}T000000Z-${String(index).padStart(8, "0")}`;
    return {
      name: `${id}.json`, location: "state", isFile: true, isSymbolicLink: false,
      mtimeMs: nowMs - (40 + index) * DAY_MS, sizeBytes: 10,
    };
  });
  const protectedId = entries.at(-1).name.replace(".json", "");
  const selected = selectHistoryCleanupCandidates(entries, {
    nowMs, retentionDays: 30, minimumKeep: 20,
    protectedDeploymentIds: new Set([protectedId]),
  });
  assert.equal(selected.length, 4);
  assert.equal(selected.some((entry) => entry.name.startsWith(protectedId)), false);
});

test("orphan deployment env files require a terminal record and 24 hour age", () => {
  const nowMs = Date.parse("2026-08-09T00:00:00Z");
  const base = "20260101T000000Z-12345678";
  const entry = (suffix, ageHours) => ({
    name: `${base}.${suffix}.env`, location: "state", isFile: true, isSymbolicLink: false,
    mtimeMs: nowMs - ageHours * 60 * 60 * 1_000, sizeBytes: 20,
  });
  const selected = selectHistoryCleanupCandidates([
    entry("candidate", 25), entry("recovery", 23), entry("rollback", 48),
  ], { nowMs, terminalDeploymentIds: new Set([base]) });
  assert.deepEqual(selected.map(({ name }) => name), [`${base}.candidate.env`, `${base}.rollback.env`]);
  assert.deepEqual(selectHistoryCleanupCandidates([entry("candidate", 48)], {
    nowMs, terminalDeploymentIds: new Set(),
  }), []);
});

test("Docker inspect failure fails image cleanup closed without any image rm", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lumina-cleanup-inspect-"));
  const logRoot = path.join(directory, "logs");
  await mkdir(logRoot);
  const commands = [];
  try {
    const result = await performPostDeploymentCleanup({
      accepted: {}, target: {}, currentDeploymentId: "current", stateRoot: directory, logRoot,
      snapshot: () => ({ totalBytes: 100, availableBytes: 50 * 1024 ** 3, usedPercentage: 50 }),
      runDocker: async (args) => {
        commands.push(args);
        if (args[0] === "buildx") return { code: 0, stdout: "" };
        if (args[0] === "image" && args[1] === "ls") return { code: 0, stdout: imageId(1) };
        if (args[0] === "image" && args[1] === "inspect") return { code: 1, stdout: "", stderr: "secret-hidden" };
        throw new Error("unexpected command");
      },
    });
    assert.equal(result.status, "PARTIAL");
    assert.deepEqual(result.warnings, ["IMAGE_CLEANUP_FAILED"]);
    assert.equal(commands.some((args) => args[0] === "image" && args[1] === "rm"), false);
    assert.doesNotMatch(JSON.stringify(result), /secret-hidden/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("image rm and BuildKit failures remain non-fatal and never change accepted application success", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lumina-cleanup-failure-"));
  const logRoot = path.join(directory, "logs");
  await mkdir(logRoot);
  const images = [
    ...releaseImages("a", 1), ...releaseImages("b", 2),
    ...releaseImages("c", 3), ...releaseImages("d", 4),
  ];
  try {
    const result = await performPostDeploymentCleanup({
      accepted: { applicationResult: "SUCCESS" }, target: {}, currentDeploymentId: "current",
      stateRoot: directory, logRoot,
      snapshot: () => ({ totalBytes: 100, availableBytes: 50 * 1024 ** 3, usedPercentage: 50 }),
      runDocker: async (args) => {
        if (args[0] === "buildx") return { code: 1, stdout: "" };
        if (args[0] === "image" && args[1] === "ls") return { code: 0, stdout: images.map(({ Id }) => Id).join("\n") };
        if (args[0] === "image" && args[1] === "inspect") return { code: 0, stdout: JSON.stringify(images) };
        if (args[0] === "container") return { code: 0, stdout: "" };
        if (args[0] === "image" && args[1] === "rm") return { code: 1, stdout: "" };
        throw new Error("unexpected command");
      },
    });
    assert.equal(result.status, "PARTIAL");
    assert.deepEqual(result.warnings, ["BUILDKIT_CLEANUP_FAILED", "IMAGE_CLEANUP_FAILED"]);
    assert.equal(result.imageBytesReclaimed, 0);
    assert.equal(nonNegativeReclaimedBytes([-100, Number.NaN]), 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("storage pressure is warning-only and never expands the Docker command allowlist", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lumina-cleanup-pressure-"));
  const logRoot = path.join(directory, "logs");
  await mkdir(logRoot);
  const commands = [];
  try {
    const result = await performPostDeploymentCleanup({
      accepted: {}, target: {}, currentDeploymentId: "current", stateRoot: directory, logRoot,
      snapshot: () => ({ totalBytes: 100, availableBytes: 1, usedPercentage: 99 }),
      runDocker: async (args) => {
        commands.push(args);
        if (args[0] === "buildx") return { code: 0, stdout: "" };
        if (args[0] === "image" && args[1] === "ls") return { code: 0, stdout: "" };
        throw new Error("unexpected command");
      },
    });
    assert.equal(result.warnings.includes("STORAGE_PRESSURE_REMAINS"), true);
    const text = JSON.stringify(commands);
    assert.doesNotMatch(text, /system|volume|network|container.*prune|image.*prune/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("static deployment contract orders acceptance, accepted state, cleanup, and finalization", async () => {
  const [runner, bootstrap, service, workflow] = await Promise.all([
    source("scripts/deploy-production-runner.mjs"),
    source("scripts/deploy-production-bootstrap.mjs"),
    source("deploy/systemd/lumina-crm-deploy.service"),
    source("scripts/lib/production-deploy-workflow.mjs"),
  ]);
  assert.match(service, /deploy-production-bootstrap\.mjs/);
  assert.doesNotMatch(service, /deploy-production-runner\.mjs/);
  assert.doesNotMatch(bootstrap, /from .*production-deploy-workflow|docker|acceptRuntime|requestCleanup|compose\.production/);
  assert.doesNotMatch(runner, /updateProductionSource|async function updateSource/);
  assert.match(
    workflow,
    /captureReleaseHealthBaseline\([\s\S]+switchApplication\(candidateEnvironment\)[\s\S]+acceptRuntime\(candidateEnvironment, \{/,
  );
  assert.match(runner, /atomicWrite\(composeEnvPath[\s\S]+atomicWrite\(acceptedPath[\s\S]+requestCleanup\(accepted\)[\s\S]+finish/);
  assert.match(runner, /request\.mode === "recover"[\s\S]+requestCleanup\(previousAccepted\)/);
  const failureHandler = runner.slice(runner.lastIndexOf("} catch (error) {"));
  assert.doesNotMatch(failureHandler, /requestCleanup/);
});

test("no deployment cleanup source contains a generic Docker prune command", async () => {
  const text = (await Promise.all([
    source("scripts/deploy-production-runner.mjs"),
    source("scripts/lib/post-deployment-cleanup.mjs"),
    source("scripts/deploy-production-bootstrap.mjs"),
  ])).join("\n");
  for (const prohibited of [
    "docker system prune", "docker image prune", "docker volume prune",
    "docker network prune", "docker container prune", "docker builder prune",
  ]) assert.equal(text.includes(prohibited), false);
});
