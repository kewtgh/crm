#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { assertDeploymentRuntime } from "./lib/deployment-runtime.mjs";
import { classifyGitFailure, fetchWithRetry } from "./lib/deployment-git.mjs";
import { assertEarlyRequestRecoverable, assertPendingAcceptance } from "./lib/deployment-recovery.mjs";
import { durableDeploymentWrite } from "./lib/deployment-state-write.mjs";

export const PRODUCTION_SOURCE_ROOT = "/opt/lumina-crm/source";
export const PRODUCTION_STATE_ROOT = "/var/lib/lumina-crm/deployments";
export const PRODUCTION_BRANCH = "main";
export const PRODUCTION_ALLOWED_ORIGINS = new Set([
  "git@github.com:kewtgh/crm.git",
  "https://github.com/kewtgh/crm.git",
]);

const REQUEST_MODES = new Set(["deploy", "initialize", "rollback", "recover"]);
const FULL_SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const isEntrypoint = process.argv[1]
  && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

function atomicWrite(file, value) {
  durableDeploymentWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function validateBootstrapRequest(request, sourceRoot = PRODUCTION_SOURCE_ROOT) {
  if (!/^[0-9a-f-]{36}$/i.test(request?.requestId ?? "")
    || !REQUEST_MODES.has(request?.mode)
    || path.resolve(request?.sourceRoot ?? "") !== sourceRoot) {
    throw new Error("Deployment request is invalid");
  }
  return request;
}

export function targetControllerArguments(targetCommit, bootstrapCommit) {
  if (!FULL_SHA.test(targetCommit) || !FULL_SHA.test(bootstrapCommit)) {
    throw new Error("Bootstrap commits must be full lowercase SHA values");
  }
  return [
    "--source-already-updated",
    `--expected-target=${targetCommit}`,
    `--bootstrap-source=${bootstrapCommit}`,
    `--bootstrap-pid=${process.pid}`,
  ];
}

function runGit(args, { environment = process.env, timeoutMs = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: PRODUCTION_SOURCE_ROOT,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-1024 * 1024); });
    child.stderr.on("data", chunk => { stderr = `${stderr}${chunk}`.slice(-65_536); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(Object.assign(new Error("BOOTSTRAP_GIT_COMMAND_FAILED"),
        { stderr: timedOut ? "connection timed out" : stderr }));
      else resolve(stdout.trim());
    });
  });
}

export async function updateSourceAndResolveTarget({
  git = runGit,
  environment = process.env,
  configuredProxy = "",
  expectedBranch = PRODUCTION_BRANCH,
  allowedOrigins = PRODUCTION_ALLOWED_ORIGINS,
  stage = () => {},
  attempts = Number(process.env.LUMINA_GIT_FETCH_ATTEMPTS ?? 3),
  delay,
  expectedTarget = null,
} = {}) {
  stage("source-validation");
  const branch = await git(["branch", "--show-current"]);
  const origin = await git(["remote", "get-url", "origin"]);
  const cleanBefore = await git(["status", "--porcelain"]);
  const bootstrapCommit = await git(["rev-parse", "HEAD"]);
  if (branch !== expectedBranch || !allowedOrigins.has(origin) || cleanBefore
    || !FULL_SHA.test(bootstrapCommit)) {
    throw new Error("BOOTSTRAP_SOURCE_INVALID");
  }

  const fetchEnvironment = { ...environment };
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] ) {
    delete fetchEnvironment[key];
  }
  const proxy = String(configuredProxy).trim();
  if (proxy) {
    fetchEnvironment.HTTP_PROXY = proxy;
    fetchEnvironment.HTTPS_PROXY = proxy;
  }
  if (expectedTarget) {
    if (bootstrapCommit !== expectedTarget) throw new Error("BOOTSTRAP_SOURCE_INVALID");
    return { bootstrapCommit, targetCommit: expectedTarget };
  }
  stage("git-fetch");
  await fetchWithRetry(options => git(["fetch", "--prune", "origin", expectedBranch],
    { ...options, environment: fetchEnvironment }), { attempts, delay, proxy: Boolean(proxy) });
  const targetCommit = await git(["rev-parse", `origin/${expectedBranch}`]);
  if (!FULL_SHA.test(targetCommit)) throw new Error("BOOTSTRAP_TARGET_INVALID");
  stage("fast-forward");
  try { await git(["merge", "--ff-only", targetCommit]); }
  catch (error) { throw classifyGitFailure(error, { operation: "fast-forward" }); }
  const [head, cleanAfter] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["status", "--porcelain"]),
  ]);
  if (head !== targetCommit || cleanAfter) throw new Error("BOOTSTRAP_SOURCE_CHANGED");
  return { bootstrapCommit, targetCommit };
}

export function validateTargetControllerAsset(sourceRoot, targetCommit) {
  const packagePath = path.join(sourceRoot, "package.json");
  const runnerPath = path.join(sourceRoot, "scripts", "deploy-production-runner.mjs");
  if (!existsSync(packagePath) || !existsSync(runnerPath)) {
    throw new Error("TARGET_CONTROLLER_ASSET_MISSING");
  }
  const metadata = lstatSync(runnerPath);
  if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(runnerPath) !== runnerPath) {
    throw new Error("TARGET_CONTROLLER_ASSET_INVALID");
  }
  const version = String(JSON.parse(readFileSync(packagePath, "utf8")).version ?? "");
  if (!VERSION.test(version) || !FULL_SHA.test(targetCommit)) {
    throw new Error("TARGET_CONTROLLER_VERSION_INVALID");
  }
  return { runnerPath, version };
}

export function spawnTargetController({
  runnerPath,
  targetCommit,
  bootstrapCommit,
  nodePath = "/usr/bin/node",
  environment = process.env,
  spawnProcess = spawn,
  sourceRoot = PRODUCTION_SOURCE_ROOT,
}) {
  return new Promise((resolve, reject) => {
    let started = false;
    const child = spawnProcess(
      nodePath,
      [runnerPath, ...targetControllerArguments(targetCommit, bootstrapCommit)],
      {
        cwd: sourceRoot,
        env: {
          ...environment,
          LUMINA_BOOTSTRAP_SOURCE_COMMIT: bootstrapCommit,
          LUMINA_TARGET_SOURCE_COMMIT: targetCommit,
        },
        stdio: "inherit",
      },
    );
    child.once("spawn", () => {
      started = true;
      process.stdout.write(`TARGET_CONTROLLER_PID=${child.pid}\n`);
    });
    child.once("error", (error) => reject(Object.assign(error, { targetControllerStarted: started })));
    child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal, pid: child.pid }));
  });
}

export async function runBootstrap({
  requestPath = path.join(PRODUCTION_STATE_ROOT, "request.json"),
  sourceRoot = PRODUCTION_SOURCE_ROOT,
  updateSource = updateSourceAndResolveTarget,
  spawnController = spawnTargetController,
} = {}) {
  const request = validateBootstrapRequest(JSON.parse(readFileSync(requestPath, "utf8")), sourceRoot);
  const latestPath = path.join(path.dirname(requestPath), "latest.json");
  const prior = readJson(latestPath);
  const resuming = request.resumePublicAcceptance === true;
  if (resuming) assertPendingAcceptance({ request, latest: prior });
  else if (prior?.requestId === request.requestId) assertEarlyRequestRecoverable({ request, latest: prior, mode: request.mode });
  const attempts = prior?.requestId === request.requestId ? [...(prior.attempts ?? prior.bootstrapAttempts ?? [])] : [];
  const attempt = { attemptId: randomUUID(), startedAt: new Date().toISOString(), controllerStarted: false, stage: "source-validation" };
  attempts.push(attempt);
  let currentStage = "source-validation";
  let controllerStarted = false;
  let sourceEvidence = {};
  const record = (result, error = null) => ({ requestId: request.requestId, mode: request.mode,
    launchId: request.launchId, deploymentId: null, result, applicationResult: "NOT_STARTED",
    stage: currentStage, error, controllerStarted, attempts, migrationState: "NOT_STARTED",
    migrationMayHaveChanged: false, webSwitch: "NOT_STARTED", workerSwitch: "NOT_STARTED",
    applicationAccepted: false, finalizationComplete: false, requestArchived: false,
    ...sourceEvidence,
    recoverySafe: ["BOOTSTRAP_FAILED", "BOOTSTRAP_RUNNING"].includes(result) && !controllerStarted
      && ["source-validation", "git-fetch", "target-asset"].includes(currentStage) });
  const save = value => {
    // A pending candidate is authoritative; never replace it with bootstrap-only state.
      try {
        atomicWrite(path.join(path.dirname(requestPath), `bootstrap-${request.requestId}-${attempt.attemptId}.json`), value);
        if (!resuming) atomicWrite(latestPath, value);
      } catch {
        const failure = { ...value, result: "CONTROL_PLANE_FINALIZATION_FAILED", recoverySafe: false,
          stage: "bootstrap-state-persistence-failed", error: "CONTROL_PLANE_FINALIZATION_FAILED" };
        try { if (!resuming) atomicWrite(latestPath, failure); } catch { /* Emit a stable failure even when storage is unavailable. */ }
        throw Object.assign(new Error("CONTROL_PLANE_FINALIZATION_FAILED"),
          { code: "CONTROL_PLANE_FINALIZATION_FAILED", bootstrapRecorded: true });
      }
  };
  try {
  process.stdout.write(`${Object.entries(assertDeploymentRuntime()).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
  save(record("BOOTSTRAP_RUNNING"));
  const { bootstrapCommit, targetCommit } = await updateSource({
    configuredProxy: process.env.LUMINA_GIT_PROXY,
    expectedTarget: resuming ? prior.targetCommit : null,
    stage: value => { currentStage = value; attempt.stage = value; save(record("BOOTSTRAP_RUNNING")); },
  });
  sourceEvidence = { bootstrapCommit, targetCommit };
  process.stdout.write(`BOOTSTRAP_SOURCE_COMMIT=${bootstrapCommit}\n`);
  process.stdout.write(`TARGET_SOURCE_COMMIT=${targetCommit}\n`);
  currentStage = "target-asset";
  const target = validateTargetControllerAsset(sourceRoot, targetCommit);
  process.stdout.write(`TARGET_APPLICATION_VERSION=${target.version}\n`);
  let latestBefore = null;
  try { latestBefore = readFileSync(latestPath, "utf8"); } catch { /* No prior controller state. */ }
  currentStage = "target-controller-start";
  // Intent is durable before handoff; a crash here cannot be replayed as a source failure.
  controllerStarted = true;
  attempt.controllerStarted = true;
  save(record("BOOTSTRAP_RUNNING"));
  const result = await spawnController({
    runnerPath: target.runnerPath,
    targetCommit,
    bootstrapCommit,
    sourceRoot,
  });
  if (result.code !== 0) {
    let latestAfter = null;
    try { latestAfter = readFileSync(latestPath, "utf8"); } catch { /* The controller did not persist state. */ }
    const latest = readJson(latestPath);
    if (latest?.requestId !== request.requestId || latestAfter === latestBefore || latest.result === "BOOTSTRAP_RUNNING") {
      currentStage = "target-controller-exit";
      save(record("BOOTSTRAP_FAILED", "TARGET_CONTROLLER_EXIT_FAILED"));
    }
  }
  return result.code;
  } catch (error) {
    if (error?.code === "CONTROL_PLANE_FINALIZATION_FAILED") throw error;
    const code = controllerStarted ? "TARGET_CONTROLLER_START_FAILED"
      : currentStage === "target-asset" ? "BOOTSTRAP_TARGET_ASSET_INVALID"
        : /^(?:BOOTSTRAP_[A-Z_]+|NODE_RUNTIME_INCOMPATIBLE)$/.test(error?.code ?? "") ? error.code
          : currentStage === "fast-forward" ? "BOOTSTRAP_GIT_FAST_FORWARD_FAILED" : "BOOTSTRAP_SOURCE_INVALID";
    attempt.finishedAt = new Date().toISOString();
    attempt.error = code;
    save(record("BOOTSTRAP_FAILED", code));
    if (code === "NODE_RUNTIME_INCOMPATIBLE") process.stderr.write(`${error.message}\n`);
    throw Object.assign(new Error(code), { code, bootstrapRecorded: true });
  }
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; }
}

export function persistBootstrapFailure(error, {
  requestPath = path.join(PRODUCTION_STATE_ROOT, "request.json"),
} = {}) {
  const stateRoot = path.dirname(requestPath);
  let request = null;
  try { request = JSON.parse(readFileSync(requestPath, "utf8")); } catch { /* No valid request to identify. */ }
  const now = new Date().toISOString();
  const state = {
    deploymentId: null,
    requestId: request?.requestId ?? null,
    mode: request?.mode ?? null,
    result: "BOOTSTRAP_FAILED",
    applicationResult: "NOT_STARTED",
    stage: "bootstrap-preflight-failed",
    finalizationComplete: false,
    requestArchived: false,
    recoverySafe: false,
    finishedAt: now,
    error: "BOOTSTRAP_SOURCE_INVALID",
  };
  try {
    // Never erase an existing application's migration/switch or terminal evidence.
    if (readJson(path.join(stateRoot, "latest.json"))?.requestId !== request?.requestId) {
      atomicWrite(path.join(stateRoot, "latest.json"), state);
    }
    atomicWrite(path.join(stateRoot, `bootstrap-failure-${Date.now()}.json`), state);
  } catch { /* systemd still receives a non-zero exit code. */ }
}

async function main() {
  if (process.platform !== "linux" || typeof process.getuid !== "function" || process.getuid() === 0) {
    throw new Error("Production deployment bootstrap must run as non-root lumina-crm on Linux");
  }
  if (path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") !== PRODUCTION_SOURCE_ROOT) {
    throw new Error(`Bootstrap must execute from ${PRODUCTION_SOURCE_ROOT}`);
  }
  const sourceMetadata = lstatSync(PRODUCTION_SOURCE_ROOT);
  if (!sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()
    || realpathSync(PRODUCTION_SOURCE_ROOT) !== PRODUCTION_SOURCE_ROOT) {
    throw new Error("BOOTSTRAP_SOURCE_ROOT_INVALID");
  }
  try {
    process.exitCode = await runBootstrap();
  } catch (error) {
    if (!error?.bootstrapRecorded) persistBootstrapFailure(error);
    process.stderr.write(`${error?.code ?? "BOOTSTRAP_FAILED"}\n`);
    process.exitCode = 1;
  }
}

if (isEntrypoint) await main();
